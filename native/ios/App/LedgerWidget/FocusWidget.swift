import WidgetKit
import SwiftUI

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

    // now, and midnight (a day-old snapshot isn't shown as today's focus); the app reloads
    // the widget whenever the focus changes
    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusEntry>) -> Void) {
        let now = Date()
        let snap = LedgerShared.read()
        var entries = [FocusEntry(date: now, snapshot: snap)]
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

private func focusSince(_ iso: String?) -> Date? {
    guard let iso = iso else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
}

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
                    FocusSet(focus: f, large: family == .systemMedium)
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
        if large {
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
