import UIKit
import Capacitor

/// Capacitor's web view, with Ledger's own native plugins registered on it.
class LedgerBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LedgerWidgetPlugin())
    }
}
