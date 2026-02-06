import SwiftUI

@available(iOS 15.0, *)
@MainActor
final class MaterialsViewModel: ObservableObject {
    @Published var loading = false
    @Published var checkoutBusy = false
    @Published var statusMessage = ""
    @Published var products: [MaterialProduct] = []
    @Published var quantities: [String: Int] = [:]
    @Published var pickupNotes = ""
    @Published var checkoutUrl: String?

    private var client: PortalApiClient?
    private var idToken: String = ""
    private var adminToken: String?

    func configure(baseUrl: String, idToken: String, adminToken: String?) {
        self.client = PortalApiClient(config: .init(baseUrl: baseUrl))
        self.idToken = idToken.trimmingCharacters(in: .whitespacesAndNewlines)
        self.adminToken = adminToken?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func loadCatalog() async {
        guard let client else {
            statusMessage = "Client not configured."
            return
        }
        guard !idToken.isEmpty else {
            statusMessage = "Add an ID token before loading materials."
            return
        }

        loading = true
        statusMessage = ""
        defer { loading = false }

        do {
            let response = try await client.listMaterialsProducts(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: ListMaterialsProductsRequest(includeInactive: false)
            )
            products = response.data.products.filter { $0.active }
            let activeIds = Set(products.map { $0.id })
            quantities = quantities.filter { activeIds.contains($0.key) }
            if products.isEmpty {
                statusMessage = "No materials available right now."
            }
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-materials-list")
            statusMessage = "Materials load failed: \(error)"
        }
    }

    func setQuantity(productId: String, value: Int) {
        let clamped = max(0, min(value, 99))
        if clamped == 0 {
            quantities.removeValue(forKey: productId)
        } else {
            quantities[productId] = clamped
        }
    }

    var cartItemCount: Int {
        quantities.values.reduce(0, +)
    }

    var cartTotalCents: Int {
        products.reduce(0) { total, product in
            total + (quantities[product.id] ?? 0) * product.priceCents
        }
    }

    func createCheckoutSession() async {
        guard let client else { return }
        guard !idToken.isEmpty else {
            statusMessage = "Add an ID token before checkout."
            return
        }
        if checkoutBusy { return }

        let items = quantities
            .filter { $0.value > 0 }
            .map { MaterialsCartItemRequest(productId: $0.key, quantity: $0.value) }

        guard !items.isEmpty else {
            statusMessage = "Add at least one item to cart."
            return
        }

        checkoutBusy = true
        statusMessage = ""
        checkoutUrl = nil
        defer { checkoutBusy = false }

        do {
            let response = try await client.createMaterialsCheckoutSession(
                idToken: idToken,
                adminToken: adminToken?.isEmpty == false ? adminToken : nil,
                payload: CreateMaterialsCheckoutSessionRequest(
                    items: items,
                    pickupNotes: pickupNotes.isEmpty ? nil : pickupNotes
                )
            )
            checkoutUrl = response.data.checkoutUrl
            if response.data.checkoutUrl == nil {
                statusMessage = "Checkout session created, but no URL returned."
            } else {
                statusMessage = "Checkout ready."
            }
        } catch {
            HandlerErrorLogStore.log(error, label: "ios-materials-checkout")
            statusMessage = "Checkout failed: \(error)"
        }
    }
}

@available(iOS 15.0, *)
struct MaterialsView: View {
    @Binding var config: PortalAppConfig
    @StateObject private var vm = MaterialsViewModel()
    @Environment(\.openURL) private var openURL

    var body: some View {
        Form {
            Section("Materials") {
                Button(vm.loading ? "Loading..." : "Load catalog") {
                    Task {
                        vm.configure(
                            baseUrl: config.resolvedBaseUrl,
                            idToken: config.idToken,
                            adminToken: config.adminToken
                        )
                        await vm.loadCatalog()
                    }
                }
                .disabled(vm.loading)
            }

            Section("Catalog") {
                if vm.products.isEmpty {
                    Text("No products loaded.")
                        .font(.footnote)
                } else {
                    ForEach(vm.products, id: \.id) { product in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(product.name)
                            Text("\(product.currency) \(Double(product.priceCents) / 100.0, specifier: "%.2f")")
                                .font(.footnote)
                            Stepper(
                                "Qty: \(vm.quantities[product.id] ?? 0)",
                                value: Binding(
                                    get: { vm.quantities[product.id] ?? 0 },
                                    set: { vm.setQuantity(productId: product.id, value: $0) }
                                ),
                                in: 0...99
                            )
                        }
                    }
                }
            }

            Section("Cart") {
                Text("Items: \(vm.cartItemCount)")
                    .font(.footnote)
                Text("Total: $\(Double(vm.cartTotalCents) / 100.0, specifier: "%.2f")")
                    .font(.footnote)
                TextField("Pickup notes (optional)", text: $vm.pickupNotes)
                Button(vm.checkoutBusy ? "Starting checkout..." : "Create checkout session") {
                    Task { await vm.createCheckoutSession() }
                }
                .disabled(vm.checkoutBusy || vm.cartItemCount == 0)

                if let checkoutUrl = vm.checkoutUrl {
                    Button("Open checkout") {
                        if let url = URL(string: checkoutUrl) {
                            openURL(url)
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
        .navigationTitle("Materials")
    }
}
