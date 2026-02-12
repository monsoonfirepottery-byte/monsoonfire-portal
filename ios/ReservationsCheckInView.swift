import SwiftUI
import UniformTypeIdentifiers

@available(iOS 15.0, *)
struct ReservationsCheckInView: View {
    @Binding var config: PortalAppConfig

    @State private var ownerUid = ""
    @State private var firingType = "bisque"
    @State private var shelfEquivalent = "0.5"
    @State private var preferredEarliestDate = ""
    @State private var preferredLatestDate = ""
    @State private var notes = ""
    @State private var selectedPhotoUrl: URL?
    @State private var selectedPhotoName = ""
    @State private var showFileImporter = false

    @State private var loading = false
    @State private var statusMessage = ""

    private let firingTypes = ["bisque", "glaze", "other"]

    var body: some View {
        Form {
            Section("Reservation Check-In") {
                TextField("Owner UID (required for photo upload)", text: $ownerUid)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Picker("Firing type", selection: $firingType) {
                    ForEach(firingTypes, id: \.self) { type in
                        Text(type.capitalized).tag(type)
                    }
                }

                TextField("Shelf equivalent (required)", text: $shelfEquivalent)
                    .keyboardType(.decimalPad)

                TextField("Preferred earliest date (optional, ISO)", text: $preferredEarliestDate)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                TextField("Preferred latest date (optional, ISO)", text: $preferredLatestDate)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                TextField("Notes (optional)", text: $notes)

                Button(selectedPhotoName.isEmpty ? "Select photo (optional)" : "Photo: \(selectedPhotoName)") {
                    showFileImporter = true
                }
            }

            Section("Submit") {
                Button(loading ? "Submitting..." : "Submit reservation") {
                    Task { await submitReservation() }
                }
                .disabled(loading)
            }

            if !statusMessage.isEmpty {
                Section("Status") {
                    Text(statusMessage)
                        .font(.footnote)
                }
            }
        }
        .navigationTitle("Check-In")
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.image]
        ) { result in
            switch result {
            case .success(let fileUrl):
                selectedPhotoUrl = fileUrl
                selectedPhotoName = fileUrl.lastPathComponent
            case .failure(let error):
                HandlerErrorLogStore.log(error, label: "ios-photo-select")
                statusMessage = "Photo select failed: \(error.localizedDescription)"
            }
        }
    }

    private func submitReservation() async {
        if loading { return }
        let token = config.idToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            statusMessage = "Add an ID token before submitting a reservation."
            return
        }

        guard let shelf = Double(shelfEquivalent), shelf > 0 else {
            statusMessage = "Shelf equivalent must be a number greater than 0."
            return
        }

        loading = true
        statusMessage = ""
        defer { loading = false }

        let client = PortalApiClient(config: .init(baseUrl: config.resolvedBaseUrl))
        let requestId = UUID().uuidString.lowercased()
        let trimmedOwnerUid = ownerUid.trimmingCharacters(in: .whitespacesAndNewlines)

        var photoUrl: String?
        var photoPath: String?
        if let selectedPhotoUrl {
            do {
                let upload = try await ReservationPhotoUploader.uploadPhoto(
                    ownerUid: trimmedOwnerUid,
                    requestId: requestId,
                    fileUrl: selectedPhotoUrl
                )
                photoUrl = upload.url
                photoPath = upload.path
            } catch {
                HandlerErrorLogStore.log(error, label: "ios-photo-upload")
                statusMessage = "Photo upload failed. Reservation was not submitted: \(error)"
                return
            }
        }

        let payload = CreateReservationRequest(
            firingType: firingType,
            shelfEquivalent: shelf,
            footprintHalfShelves: nil,
            heightInches: nil,
            tiers: nil,
            estimatedHalfShelves: nil,
            useVolumePricing: nil,
            volumeIn3: nil,
            estimatedCost: nil,
            preferredWindow: ReservationPreferredWindow(
                earliestDate: preferredEarliestDate.isEmpty ? nil : preferredEarliestDate,
                latestDate: preferredLatestDate.isEmpty ? nil : preferredLatestDate
            ),
            linkedBatchId: nil,
            clientRequestId: requestId,
            ownerUid: trimmedOwnerUid.isEmpty ? nil : trimmedOwnerUid,
            wareType: nil,
            kilnId: nil,
            kilnLabel: nil,
            quantityTier: nil,
            quantityLabel: nil,
            photoUrl: photoUrl,
            photoPath: photoPath,
            dropOffProfile: nil,
            dropOffQuantity: nil,
            notes: ReservationNotes(
                general: notes.isEmpty ? nil : notes,
                clayBody: nil,
                glazeNotes: nil
            ),
            addOns: nil
        )

        do {
            let result = try await client.createReservation(
                idToken: token,
                adminToken: config.adminToken,
                payload: payload
            )
            let reservationId = result.data.reservationId ?? "unknown"
            let status = result.data.status ?? "REQUESTED"
            statusMessage = "Created reservation \(reservationId) with status \(status)."
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-createReservation")
            statusMessage = "Submit failed: \(error)"
        }
    }
}
