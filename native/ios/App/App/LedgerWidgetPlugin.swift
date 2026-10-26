import Foundation
import Capacitor
import WidgetKit

/// The web app's way to the Today widget. The page hands over the snapshot it built (by
/// Ledger's own rules); this keeps it in the shared App Group and asks WidgetKit to redraw.
/// Nothing here interprets Ledger data — it only checks the shape and size.
@objc(LedgerWidgetPlugin)
public class LedgerWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LedgerWidgetPlugin"
    public let jsName = "LedgerWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private static let maxBytes = 64 * 1024

    @objc func publish(_ call: CAPPluginCall) {
        guard let json = call.getString("snapshot"),
              let data = json.data(using: .utf8), data.count <= Self.maxBytes,
              (try? JSONDecoder().decode(TodaySnapshot.self, from: data)) != nil else {
            call.reject("Not a Today snapshot")
            return
        }
        guard LedgerShared.write(data) else {
            call.reject("The App Group isn't available to this build")
            return
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        LedgerShared.clear()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
