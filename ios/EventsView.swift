import SwiftUI

private enum RosterFilter: String, CaseIterable, Identifiable {
    case all
    case ticketed
    case waitlisted
    case offered
    case checkedIn = "checked_in"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .ticketed: return "Ticketed"
        case .waitlisted: return "Waitlisted"
        case .offered: return "Offered"
        case .checkedIn: return "Checked in"
        }
    }
}

@available(iOS 15.0, *)
@MainActor
final class EventsViewModel: ObservableObject {
    @Published var includeDrafts = false
    @Published var includeCancelled = false
    @Published var loading = false
    @Published var detailLoading = false
    @Published var actionBusy = false
    @Published var statusMessage = ""
    @Published var events: [EventSummary] = []
    @Published var selectedEventId: String?
    @Published var selectedEventDetail: EventDetail?
    @Published var selectedSignup: EventSignupSummary?
    @Published var roster: [EventSignupRosterEntry] = []
    @Published var rosterLoading = false
    @Published var rosterError = ""
    @Published var rosterIncludeCancelled = false
    @Published var rosterIncludeExpired = false
    @Published var rosterSearch = ""
    @Published var rosterFilter: RosterFilter = .all
    @Published var rosterBusyIds: [String: Bool] = [:]

    private var client: PortalApiClient?
    private var idToken: String = ""
    private var adminToken: String?

    var hasAdmin: Bool {
        adminToken?.isEmpty == false
    }

    var filteredRoster: [EventSignupRosterEntry] {
        let term = rosterSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return roster.filter { row in
            if rosterFilter != .all && row.status != rosterFilter.rawValue { return false }
            if term.isEmpty { return true }
            let displayName = row.displayName?.lowercased() ?? ""
            let email = row.email?.lowercased() ?? ""
            return displayName.contains(term) || email.contains(term)
        }
    }

    func configure(baseUrl: String, idToken: String, adminToken: String?) {
        self.client = PortalApiClient(config: .init(baseUrl: baseUrl))
        self.idToken = idToken.trimmingCharacters(in: .whitespacesAndNewlines)
        self.adminToken = adminToken?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func loadEvents() async {
        guard let client else {
            statusMessage = "Client not configured."
            return
        }
        guard !idToken.isEmpty else {
            statusMessage = "Add an ID token before loading events."
            return
        }

        loading = true
        statusMessage = ""
        defer { loading = false }

        do {
            let response = try await client.listEvents(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: ListEventsRequest(
                    includeDrafts: includeDrafts,
                    includeCancelled: includeCancelled
                )
            )
            events = response.data.events
            if selectedEventId == nil {
                selectedEventId = response.data.events.first?.id
            }
            if let selectedEventId {
                await loadDetail(eventId: selectedEventId)
                if hasAdmin {
                    await loadRoster(eventId: selectedEventId)
                } else {
                    roster = []
                }
            }
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-events-list")
            statusMessage = "Events load failed: \(error)"
        }
    }

    func loadDetail(eventId: String) async {
        guard let client else { return }
        guard !idToken.isEmpty else { return }

        detailLoading = true
        statusMessage = ""
        defer { detailLoading = false }

        do {
            let response = try await client.getEvent(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: GetEventRequest(eventId: eventId)
            )
            selectedEventId = eventId
            selectedEventDetail = response.data.event
            selectedSignup = response.data.signup
            if hasAdmin {
                await loadRoster(eventId: eventId)
            } else {
                roster = []
            }
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-events-detail")
            statusMessage = "Event detail failed: \(error)"
        }
    }

    func signup() async {
        guard let client, let eventId = selectedEventDetail?.id else { return }
        if actionBusy { return }

        actionBusy = true
        statusMessage = ""
        defer { actionBusy = false }

        do {
            let response = try await client.signupForEvent(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: SignupForEventRequest(eventId: eventId)
            )
            statusMessage = response.data.status == "ticketed"
                ? "You're in."
                : "Signed up (waitlist)."
            await loadDetail(eventId: eventId)
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-events-signup")
            statusMessage = "Signup failed: \(error)"
        }
    }

    func cancelSignup() async {
        guard let client, let eventId = selectedEventDetail?.id, let signupId = selectedSignup?.id else { return }
        if actionBusy { return }

        actionBusy = true
        statusMessage = ""
        defer { actionBusy = false }

        do {
            _ = try await client.cancelEventSignup(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: CancelEventSignupRequest(signupId: signupId)
            )
            statusMessage = "Signup cancelled."
            await loadDetail(eventId: eventId)
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-events-cancel")
            statusMessage = "Cancel failed: \(error)"
        }
    }

    func loadRoster(eventId: String) async {
        guard hasAdmin, let client else {
            roster = []
            return
        }
        rosterLoading = true
        rosterError = ""
        defer { rosterLoading = false }

        do {
            let response = try await client.listEventSignups(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: ListEventSignupsRequest(
                    eventId: eventId,
                    includeCancelled: rosterIncludeCancelled,
                    includeExpired: rosterIncludeExpired,
                    limit: 300
                )
            )
            roster = response.data.signups
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-events-roster")
            rosterError = "Roster load failed: \(error)"
        }
    }

    func staffCheckIn(signupId: String) async {
        guard hasAdmin, let client, let eventId = selectedEventDetail?.id else { return }
        if rosterBusyIds[signupId] == true { return }
        rosterBusyIds[signupId] = true
        statusMessage = ""
        defer { rosterBusyIds[signupId] = false }

        do {
            _ = try await client.checkInEvent(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: CheckInEventRequest(
                    signupId: signupId,
                    method: "staff"
                )
            )
            statusMessage = "Attendee checked in."
            await loadRoster(eventId: eventId)
            await loadDetail(eventId: eventId)
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-events-staff-checkin")
            statusMessage = "Staff check-in failed: \(error)"
        }
    }
}

@available(iOS 15.0, *)
struct EventsView: View {
    @Binding var config: PortalAppConfig
    @StateObject private var vm = EventsViewModel()

    var body: some View {
        Form {
            Section("Events") {
                Toggle("Include drafts", isOn: $vm.includeDrafts)
                Toggle("Include cancelled", isOn: $vm.includeCancelled)
                Button(vm.loading ? "Loading..." : "Load events") {
                    Task {
                        vm.configure(
                            baseUrl: config.resolvedBaseUrl,
                            idToken: config.idToken,
                            adminToken: config.adminToken
                        )
                        await vm.loadEvents()
                    }
                }
                .disabled(vm.loading)
            }

            Section("Event list") {
                if vm.events.isEmpty {
                    Text("No events loaded.")
                        .font(.footnote)
                } else {
                    ForEach(vm.events, id: \.id) { event in
                        Button("\(event.title) · \(event.status)") {
                            Task { await vm.loadDetail(eventId: event.id) }
                        }
                    }
                }
            }

            Section("Event detail") {
                if vm.detailLoading {
                    Text("Loading detail...")
                        .font(.footnote)
                } else if let detail = vm.selectedEventDetail {
                    Text(detail.title)
                    Text(detail.summary)
                        .font(.footnote)
                    Text("Starts: \(detail.startAt ?? "-")")
                        .font(.footnote)
                    Text("Status: \(detail.status)")
                        .font(.footnote)
                    Text("Signup: \(vm.selectedSignup?.status ?? "none")")
                        .font(.footnote)
                    HStack {
                        Button(vm.actionBusy ? "Working..." : "Signup") {
                            Task { await vm.signup() }
                        }
                        .disabled(vm.actionBusy)

                        Button(vm.actionBusy ? "Working..." : "Cancel signup") {
                            Task { await vm.cancelSignup() }
                        }
                        .disabled(vm.actionBusy || vm.selectedSignup == nil)
                    }
                } else {
                    Text("Select an event to view details.")
                        .font(.footnote)
                }
            }

            if vm.hasAdmin {
                Section("Staff roster") {
                    Toggle("Include cancelled", isOn: $vm.rosterIncludeCancelled)
                    Toggle("Include expired", isOn: $vm.rosterIncludeExpired)
                    Picker("Filter", selection: $vm.rosterFilter) {
                        ForEach(RosterFilter.allCases) { filter in
                            Text(filter.label).tag(filter)
                        }
                    }
                    TextField("Search name/email", text: $vm.rosterSearch)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Button(vm.rosterLoading ? "Loading roster..." : "Load roster") {
                        Task {
                            if let eventId = vm.selectedEventId {
                                await vm.loadRoster(eventId: eventId)
                            }
                        }
                    }
                    .disabled(vm.rosterLoading || vm.selectedEventId == nil)

                    if vm.rosterLoading {
                        Text("Loading roster...")
                            .font(.footnote)
                    } else if vm.filteredRoster.isEmpty {
                        Text("No roster entries for this filter.")
                            .font(.footnote)
                    } else {
                        ForEach(vm.filteredRoster, id: \.id) { row in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(row.displayName ?? "Attendee")
                                Text(row.email ?? row.uid ?? "-")
                                    .font(.footnote)
                                Text("Status: \(row.status)")
                                    .font(.footnote)
                                if row.status == "checked_in" && row.paymentStatus != "paid" {
                                    Text("UNPAID")
                                        .font(.footnote)
                                }
                                if row.status == "ticketed" {
                                    Button(vm.rosterBusyIds[row.id] == true ? "Checking..." : "Check in attendee") {
                                        Task { await vm.staffCheckIn(signupId: row.id) }
                                    }
                                    .disabled(vm.rosterBusyIds[row.id] == true)
                                }
                            }
                        }
                    }

                    if !vm.rosterError.isEmpty {
                        Text(vm.rosterError)
                            .font(.footnote)
                    }
                }
            }

            if !vm.statusMessage.isEmpty {
                Section("Status") {
                    Text(vm.statusMessage)
                        .font(.footnote)
                }
            }
        }
        .navigationTitle("Events")
        .onChange(of: vm.rosterIncludeCancelled) { _ in
            Task {
                if let eventId = vm.selectedEventId, vm.hasAdmin {
                    await vm.loadRoster(eventId: eventId)
                }
            }
        }
        .onChange(of: vm.rosterIncludeExpired) { _ in
            Task {
                if let eventId = vm.selectedEventId, vm.hasAdmin {
                    await vm.loadRoster(eventId: eventId)
                }
            }
        }
    }
}
