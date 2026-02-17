import SwiftUI

@available(iOS 15.0, *)
@MainActor
final class BillingViewModel: ObservableObject {
    @Published var loading = false
    @Published var statusMessage = ""
    @Published var unpaidCheckIns: [EventSignupRosterEntry] = []
    @Published var materialsOrders: [MaterialOrderSummary] = []
    @Published var receipts: [BillingReceipt] = []
    @Published var summary: BillingSummaryTotals?

    private var client: PortalApiClient?
    private var idToken: String = ""
    private var adminToken: String?

    func configure(baseUrl: String, idToken: String, adminToken: String?) {
        self.client = PortalApiClient(config: .init(baseUrl: baseUrl))
        self.idToken = idToken.trimmingCharacters(in: .whitespacesAndNewlines)
        self.adminToken = adminToken?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func loadBilling() async {
        guard let client else {
            statusMessage = "Client not configured."
            return
        }
        guard !idToken.isEmpty else {
            statusMessage = "Add an ID token before loading billing."
            return
        }

        loading = true
        statusMessage = ""
        defer { loading = false }

        do {
            let response = try await client.listBillingSummary(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: ListBillingSummaryRequest(limit: 100, from: nil, to: nil)
            )
            unpaidCheckIns = response.data.unpaidCheckIns
            materialsOrders = response.data.materialsOrders
            receipts = response.data.receipts
            summary = response.data.summary
            if unpaidCheckIns.isEmpty && materialsOrders.isEmpty && receipts.isEmpty {
                statusMessage = "No billing activity found."
            }
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-billing-list")
            statusMessage = "Billing load failed: \(error)"
        }
    }
}

@available(iOS 15.0, *)
struct BillingView: View {
    @Binding var config: PortalAppConfig
    @StateObject private var vm = BillingViewModel()

    var body: some View {
        Form {
            Section("Billing summary") {
                Button(vm.loading ? "Loading..." : "Load billing") {
                    Task {
                        vm.configure(
                            baseUrl: config.resolvedBaseUrl,
                            idToken: config.idToken,
                            adminToken: config.adminToken
                        )
                        await vm.loadBilling()
                    }
                }
                .disabled(vm.loading)

                if let summary = vm.summary {
                    Text("Unpaid check-ins: \(summary.unpaidCheckInsCount) · $\(Double(summary.unpaidCheckInsAmountCents) / 100.0, specifier: "%.2f")")
                        .font(.footnote)
                    Text("Materials pending: \(summary.materialsPendingCount) · $\(Double(summary.materialsPendingAmountCents) / 100.0, specifier: "%.2f")")
                        .font(.footnote)
                    Text("Receipts: \(summary.receiptsCount) · $\(Double(summary.receiptsAmountCents) / 100.0, specifier: "%.2f")")
                        .font(.footnote)
                }
            }

            Section("Unpaid check-ins") {
                if vm.unpaidCheckIns.isEmpty {
                    Text("No unpaid check-ins.")
                        .font(.footnote)
                } else {
                    ForEach(vm.unpaidCheckIns, id: \.id) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.displayName ?? "Attendee")
                            Text(row.email ?? row.uid ?? "-")
                                .font(.footnote)
                            Text("Status: \(row.status) · Payment: \(row.paymentStatus ?? "unknown")")
                                .font(.footnote)
                        }
                    }
                }
            }

            Section("Materials orders") {
                if vm.materialsOrders.isEmpty {
                    Text("No materials orders.")
                        .font(.footnote)
                } else {
                    ForEach(vm.materialsOrders, id: \.id) { order in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Order \(order.id)")
                            Text("Status: \(order.status) · $\(Double(order.totalCents) / 100.0, specifier: "%.2f")")
                                .font(.footnote)
                            if let notes = order.pickupNotes, !notes.isEmpty {
                                Text("Pickup notes: \(notes)")
                                    .font(.footnote)
                            }
                        }
                    }
                }
            }

            Section("Receipts") {
                if vm.receipts.isEmpty {
                    Text("No receipts.")
                        .font(.footnote)
                } else {
                    ForEach(vm.receipts, id: \.id) { receipt in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(receipt.title)
                            Text("\(receipt.type.rawValue) · $\(Double(receipt.amountCents) / 100.0, specifier: "%.2f")")
                                .font(.footnote)
                            Text("Paid: \(receipt.paidAt ?? "unknown")")
                                .font(.footnote)
                        }
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
        .navigationTitle("Billing")
    }
}
