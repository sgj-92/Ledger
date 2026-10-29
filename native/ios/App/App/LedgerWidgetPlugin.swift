import Foundation
import UIKit
import Capacitor
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// The web app's way to the Today widget. The page hands over the snapshot it built (by
/// Ledger's own rules); this keeps it in the shared App Group and asks WidgetKit to redraw.
/// Nothing here interprets Ledger data — it only checks the shape and size.
/// It also carries the focus timer's Live Activity and the full-screen focus view's
/// keep-awake switch (2026-10-29): both are about what the phone shows, never Ledger data.
@objc(LedgerWidgetPlugin)
public class LedgerWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LedgerWidgetPlugin"
    public let jsName = "LedgerWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "focusActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endFocusActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise)
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

    // ---- the focus timer's Live Activity ----

    private static func isoDate(_ s: String?) -> Date? {
        guard let s = s else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    /// Start the countdown, or update the one already showing (a new length, +5 min, the
    /// next exercise). There is only ever one. Resolves { shown: false } where the phone
    /// can't show one (before iOS 16.2, or Live Activities turned off for Ledger).
    @objc func focusActivity(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { call.resolve(["shown": false]); return }
        guard let title = call.getString("title"), !title.isEmpty,
              let endsAt = Self.isoDate(call.getString("endsAt")) else {
            call.reject("A title and an end time")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(["shown": false]); return }
        let started = min(Self.isoDate(call.getString("startedAt")) ?? Date(), endsAt)
        let state = FocusActivityAttributes.ContentState(
            title: String(title.prefix(200)),
            context: call.getString("context").map { String($0.prefix(120)) },
            startedAt: started, endsAt: endsAt)
        // past endsAt the system marks it stale and the views say "Time's up"
        let content = ActivityContent(state: state, staleDate: endsAt)
        Task {
            let running = Activity<FocusActivityAttributes>.activities
            if let current = running.first {
                await current.update(content)
                for extra in running.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
                call.resolve(["shown": true])
                return
            }
            do {
                _ = try Activity.request(attributes: FocusActivityAttributes(), content: content, pushType: nil)
                call.resolve(["shown": true])
            } catch {
                call.reject("The Live Activity couldn't start: \(error.localizedDescription)")
            }
        }
        #else
        call.resolve(["shown": false])
        #endif
    }

    /// The timer stopped, the focus done or cleared: take it off the Lock Screen.
    @objc func endFocusActivity(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        Task {
            for activity in Activity<FocusActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
        #else
        call.resolve()
        #endif
    }

    /// The full-screen focus view keeps the screen on while it's open.
    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }
}
