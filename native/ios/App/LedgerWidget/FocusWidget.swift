import WidgetKit
import SwiftUI
import ActivityKit

// Ledger's "Focus" widget: the Current Focus and nothing else, so the one thing being done
// now sits on the Home Screen once it's set. It comes from the same snapshot as Today
// (version 3, `focus`: only a focus that still points at something live). Tapping it
// opens that Action or sprint; with no focus, it opens the picker to choose one.

struct FocusEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot?
}

struct FocusProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocusEntry {
        FocusEntry(date: Date(), snapshot: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (FocusEntry) -> Void) {
        completion(FocusEntry(date: Date(), snapshot: context.isPreview ? (LedgerShared.read() ?? .preview) : LedgerShared.read()))
    }

    // now, the moment a focus timer ends (to say "Time's up"), and midnight (a day-old
    // snapshot isn't shown as today's focus); the app reloads the widget whenever the focus
    // or its timer changes
    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusEntry>) -> Void) {
        let now = Date()
        let snap = LedgerShared.read()
        var entries = [FocusEntry(date: now, snapshot: snap)]
        if let end = focusDate(snap?.focus?.endsAt), end > now {
            entries.append(FocusEntry(date: end, snapshot: snap))
        }
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) {
            entries.append(FocusEntry(date: midnight, snapshot: snap))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LedgerFocus", provider: FocusProvider()) { entry in
            FocusWidgetView(entry: entry)
                .containerBackground(Palette.ground, for: .widget)
        }
        .configurationDisplayName("Focus")
        .description("The one thing you're focusing on now.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private let chooseFocusURL = URL(string: "\(LedgerShared.appScheme)://open?view=focus")!
private let openTodayURL = URL(string: "\(LedgerShared.appScheme)://open?view=today")!

private func focusDate(_ iso: String?) -> Date? {
    guard let iso = iso else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
}
private func focusSince(_ iso: String?) -> Date? { focusDate(iso) }

struct FocusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FocusEntry

    // only today's snapshot speaks for now
    private var snapshot: TodaySnapshot? {
        guard let s = entry.snapshot, s.date == LedgerShared.localDate(entry.date) else { return nil }
        return s
    }

    var body: some View {
        Group {
            if let s = snapshot {
                if let f = s.focus {
                    FocusSet(focus: f, large: family == .systemMedium, now: entry.date)
                } else {
                    NoFocus(large: family == .systemMedium)
                }
            } else {
                FocusOpenLedger(signedOut: entry.snapshot == nil)
            }
        }
        .widgetURL(url)
    }

    private var url: URL {
        guard let s = snapshot else { return openTodayURL }
        if let f = s.focus, let u = URL(string: f.link) { return u }
        return chooseFocusURL
    }
}

// "FOCUS NOW", in gold: there's no mistaking what this is
private struct FocusKicker: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "scope")
                .font(.system(size: 11, weight: .semibold))
            Text("FOCUS NOW")
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.6)
        }
        .foregroundStyle(Palette.gold)
        .widgetAccentable()
    }
}

private struct FocusSet: View {
    let focus: TodaySnapshot.Focus
    let large: Bool
    let now: Date
    var body: some View {
        HStack(spacing: 12) {
            // a gold rule down the side: the widget's one strong mark
            if large {
                Capsule()
                    .fill(Palette.gold)
                    .frame(width: 3)
                    .widgetAccentable()
            }
            VStack(alignment: .leading, spacing: large ? 8 : 6) {
                FocusKicker()
                Spacer(minLength: 0)
                Text(focus.title)
                    .font(.system(size: large ? 22 : 18, weight: .regular, design: .serif))
                    .foregroundStyle(Palette.text)
                    .lineLimit(large ? 3 : 4)
                    .minimumScaleFactor(0.8)
                    .multilineTextAlignment(.leading)
                    .privacySensitive()
                Spacer(minLength: 0)
                footer
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var footer: some View {
        let since = focusSince(focus.setAt)
        let end = focusDate(focus.endsAt)
        if let end = end {
            // a focus timer: the time left, counting down on the Home Screen, then "Time's up"
            HStack(spacing: 5) {
                Image(systemName: "timer")
                    .font(.system(size: 11, weight: .semibold))
                if end > now {
                    Text(timerInterval: now...end, countsDown: true)
                        .monospacedDigit()
                } else {
                    Text("Time's up")
                }
            }
            .font(.system(size: large ? 13 : 12, weight: .semibold))
            .foregroundStyle(end > now ? Palette.gold : Palette.text2)
            .widgetAccentable()
        } else if large {
            HStack(spacing: 6) {
                if let ctx = focus.context {
                    Text(ctx).lineLimit(1)
                }
                if focus.context != nil && since != nil { Text("·") }
                if let since = since {
                    Text("since ") + Text(since, style: .time)
                }
            }
            .font(.system(size: 11))
            .foregroundStyle(Palette.text2)
        } else if let since = since {
            (Text("Since ") + Text(since, style: .time))
                .font(.system(size: 11))
                .foregroundStyle(Palette.text2)
        } else if let ctx = focus.context {
            Text(ctx)
                .font(.system(size: 11))
                .foregroundStyle(Palette.text2)
                .lineLimit(1)
        }
    }
}

private struct NoFocus: View {
    let large: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: "scope")
                    .font(.system(size: 11, weight: .semibold))
                Text("FOCUS")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.6)
            }
            .foregroundStyle(Palette.text3)
            Spacer(minLength: 0)
            Text("No focus set")
                .font(.system(size: large ? 20 : 17, design: .serif))
                .foregroundStyle(Palette.text)
            Text("Tap to choose what to focus on")
                .font(.system(size: 11))
                .foregroundStyle(Palette.text2)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FocusOpenLedger: View {
    let signedOut: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("FOCUS")
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(Palette.text3)
            Spacer(minLength: 0)
            Text(signedOut ? "Sign in to Ledger" : "Open Ledger")
                .font(.system(.title3, design: .serif))
                .foregroundStyle(Palette.text)
            Text(signedOut ? "Your focus appears here" : "to see your focus")
                .font(.caption)
                .foregroundStyle(Palette.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// ---- the focus timer's Live Activity (2026-10-29) ----
// The time left on the Lock Screen and in the Dynamic Island while a focus timer runs,
// counting down with Ledger closed. The app starts, updates and ends it (LedgerWidget's
// `focusActivity`); the system ticks the countdown itself. Past endsAt it's stale, and
// says "Time's up" until Ledger next opens or the timer changes.

// the Dynamic Island is always dark: the dark theme's colours, fixed
private let islandGold = Color(hex: 0xDCB878)
private let islandText = Color(hex: 0xF0E9DD)
private let islandText2 = Color(hex: 0xA89B88)
private let timeUpColor = Color.ledger(0xC66A54, 0xA4452E)

private func focusTimeUp(_ state: FocusActivityAttributes.ContentState, stale: Bool) -> Bool {
    stale || state.endsAt <= Date()
}
// a closed range never runs backwards: start is never after the end
private func focusRange(_ state: FocusActivityAttributes.ContentState) -> ClosedRange<Date> {
    min(state.startedAt, state.endsAt)...state.endsAt
}

struct FocusLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusActivityLockScreen(state: context.state, up: focusTimeUp(context.state, stale: context.isStale))
                .activityBackgroundTint(Palette.ground)
                .activitySystemActionForegroundColor(Palette.gold)
                .widgetURL(openTodayURL)
        } dynamicIsland: { context in
            let up = focusTimeUp(context.state, stale: context.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        Image(systemName: "scope")
                        Text("FOCUS").tracking(1.4)
                    }
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(islandGold)
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    FocusCountdown(state: context.state, up: up, size: 22, color: islandGold, upColor: islandText2)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(context.state.title)
                            .font(.system(size: 17, design: .serif))
                            .foregroundStyle(islandText)
                            .lineLimit(2)
                        if let ctx = context.state.context, !ctx.isEmpty {
                            Text(ctx)
                                .font(.system(size: 12))
                                .foregroundStyle(islandText2)
                                .lineLimit(1)
                        }
                        if !up {
                            ProgressView(timerInterval: focusRange(context.state), countsDown: true,
                                         label: { EmptyView() }, currentValueLabel: { EmptyView() })
                                .tint(islandGold)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "scope")
                    .foregroundStyle(islandGold)
            } compactTrailing: {
                FocusCountdown(state: context.state, up: up, size: 14, color: islandGold, upColor: islandText2, compact: true)
            } minimal: {
                Image(systemName: up ? "bell.fill" : "timer")
                    .foregroundStyle(islandGold)
            }
            .widgetURL(openTodayURL)
            .keylineTint(islandGold)
        }
    }
}

// the time left, ticking, or "Time's up"
private struct FocusCountdown: View {
    let state: FocusActivityAttributes.ContentState
    let up: Bool
    let size: CGFloat
    let color: Color
    let upColor: Color
    var compact = false
    var body: some View {
        if up {
            Text(compact ? "Up" : "Time's up")
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(upColor)
        } else {
            // a timer's text takes all the width it's offered: give it what it needs
            let long = state.endsAt.timeIntervalSince(Date()) >= 3600
            Text(timerInterval: focusRange(state), countsDown: true)
                .font(.system(size: size, weight: .semibold))
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(color)
                .frame(width: compact ? (long ? 58 : 42) : (long ? 100 : 74), alignment: .trailing)
        }
    }
}

private struct FocusActivityLockScreen: View {
    let state: FocusActivityAttributes.ContentState
    let up: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 5) {
                        Image(systemName: "scope")
                        Text("FOCUS").tracking(1.6)
                    }
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                    Text(state.title)
                        .font(.system(size: 18, design: .serif))
                        .foregroundStyle(Palette.text)
                        .lineLimit(2)
                    if let ctx = state.context, !ctx.isEmpty {
                        Text(ctx)
                            .font(.system(size: 12))
                            .foregroundStyle(Palette.text2)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if up {
                    Text("Time's up")
                        .font(.system(size: 22, design: .serif))
                        .foregroundStyle(timeUpColor)
                } else {
                    let long = state.endsAt.timeIntervalSince(Date()) >= 3600
                    Text(timerInterval: focusRange(state), countsDown: true)
                        .font(.system(size: 34, weight: .regular, design: .serif))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(Palette.text)
                        .frame(width: long ? 140 : 100, alignment: .trailing)
                }
            }
            if !up {
                ProgressView(timerInterval: focusRange(state), countsDown: true,
                             label: { EmptyView() }, currentValueLabel: { EmptyView() })
                    .tint(Palette.gold)
            }
        }
        .padding(16)
    }
}

#Preview(as: .systemSmall) {
    FocusWidget()
} timeline: {
    FocusEntry(date: .now, snapshot: .preview)
}

#Preview(as: .systemMedium) {
    FocusWidget()
} timeline: {
    FocusEntry(date: .now, snapshot: .preview)
}
