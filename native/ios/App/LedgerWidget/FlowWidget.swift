import WidgetKit
import SwiftUI

// Ledger's "Flow" widget: the whole of today's Flow in Shaun's order — Actions, training and
// Reset Sprints, with their times, what's ticked, and the now line — from the same snapshot
// as Today (version 4, `flow`). The now line is placed here, by Flow's own rule
// (index.html, renderFlow): after the last step that has started or been ticked off, never
// past a timed step still to come. A long day shows the stretch around now. Tapping an
// Action opens it; anywhere else opens Today in Flow.

struct FlowEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot?
}

// "HH:MM" today, as a time; the snapshot's times are the phone's own local times
private func flowClock(_ hhmm: String, on day: Date) -> Date? {
    let parts = hhmm.split(separator: ":")
    guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
    return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: day)
}

private func flowHHMM(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.hour, .minute], from: date)
    return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
}

struct FlowProvider: TimelineProvider {
    func placeholder(in context: Context) -> FlowEntry {
        FlowEntry(date: Date(), snapshot: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (FlowEntry) -> Void) {
        completion(FlowEntry(date: Date(), snapshot: context.isPreview ? (LedgerShared.read() ?? .preview) : LedgerShared.read()))
    }

    // now, at each start still to come today (so the now line moves on by itself), and
    // midnight; the app reloads the widget whenever the Flow changes
    func getTimeline(in context: Context, completion: @escaping (Timeline<FlowEntry>) -> Void) {
        let now = Date()
        let snap = LedgerShared.read()
        var dates: Set<Date> = [now]
        for step in snap?.flow ?? [] {
            if let t = step.time, let d = flowClock(t, on: now), d > now { dates.insert(d) }
        }
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) {
            dates.insert(midnight)
        }
        let entries = dates.sorted().prefix(30).map { FlowEntry(date: $0, snapshot: snap) }
        completion(Timeline(entries: Array(entries), policy: .atEnd))
    }
}

struct FlowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LedgerFlow", provider: FlowProvider()) { entry in
            FlowWidgetView(entry: entry)
                .containerBackground(Palette.ground, for: .widget)
        }
        .configurationDisplayName("Flow")
        .description("Today's Flow in your order, with times and where you are now.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private let flowURL = URL(string: "\(LedgerShared.appScheme)://open?view=today&mode=flow")!

private enum FlowRow: Identifiable {
    case step(TodaySnapshot.FlowItem)
    case now

    var id: String {
        switch self {
        case .step(let s): return s.kind + "-" + s.id
        case .now: return "now"
        }
    }
}

// The Flow as rows, with the now line in its place, and which rows fit: the stretch from
// just before now, as many as there's room for
private struct FlowLayout {
    let rows: [FlowRow]
    let shown: [FlowRow]
    let later: Int          // steps after the shown stretch

    init(_ steps: [TodaySnapshot.FlowItem], at date: Date, limit: Int) {
        var rows = steps.map { FlowRow.step($0) }
        var anchor = steps.firstIndex(where: { !$0.done }) ?? max(0, steps.count - 1)
        // the now line, as Flow draws it — only once the day has a time in it
        if steps.contains(where: { $0.time != nil }) {
            let now = flowHHMM(date)
            let limitIndex = steps.firstIndex(where: { ($0.time ?? "") > now }) ?? steps.count
            var behind = -1
            for i in 0..<limitIndex {
                let started = steps[i].time.map { $0 <= now } ?? false
                if started || steps[i].done { behind = i }
            }
            anchor = behind + 1
            rows.insert(.now, at: anchor)
        }
        var start = 0
        if rows.count > limit {
            start = min(max(0, anchor - 1), rows.count - limit)
        }
        let end = min(rows.count, start + limit)
        self.rows = rows
        self.shown = Array(rows[start..<end])
        self.later = rows[end...].filter { if case .step = $0 { return true }; return false }.count
    }
}

struct FlowWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FlowEntry

    // only today's snapshot speaks for today
    private var today: TodaySnapshot? {
        guard let s = entry.snapshot, s.date == LedgerShared.localDate(entry.date) else { return nil }
        return s
    }

    var body: some View {
        Group {
            if let s = today, let steps = s.flow {
                FlowList(s: s, steps: steps, date: entry.date, limit: family == .systemLarge ? 11 : 4)
            } else {
                FlowMessage(signedOut: entry.snapshot == nil)
            }
        }
        .widgetURL(flowURL)
    }
}

private struct FlowList: View {
    let s: TodaySnapshot
    let steps: [TodaySnapshot.FlowItem]
    let date: Date
    let limit: Int

    var body: some View {
        let layout = FlowLayout(steps, at: date, limit: limit)
        let done = steps.filter { $0.done }.count
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("FLOW")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.6)
                    .foregroundStyle(Palette.gold)
                    .widgetAccentable()
                Text(s.dayLabel)
                    .font(.system(size: 11))
                    .foregroundStyle(Palette.text2)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text("\(done) of \(steps.count) done")
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(Palette.text2)
                    .lineLimit(1)
            }
            .padding(.bottom, 6)
            if steps.isEmpty {
                Spacer(minLength: 0)
                Text("Nothing in the day yet")
                    .font(.system(.body, design: .serif))
                    .foregroundStyle(Palette.text)
                Spacer(minLength: 0)
            } else {
                ForEach(layout.shown) { row in
                    FlowRowView(row: row, date: date)
                }
                Spacer(minLength: 0)
                if layout.later > 0 {
                    Text("+\(layout.later) more")
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.text3)
                }
            }
        }
    }
}

private struct FlowRowView: View {
    let row: FlowRow
    let date: Date

    var body: some View {
        switch row {
        case .now:
            NowLine(date: date)
        case .step(let step):
            if step.kind == "action", let url = URL(string: step.link) {
                Link(destination: url) { StepLine(step: step) }
            } else {
                StepLine(step: step)
            }
        }
    }
}

private struct StepLine: View {
    let step: TodaySnapshot.FlowItem

    var body: some View {
        HStack(spacing: 8) {
            Text(step.time ?? "")
                .font(.system(size: 10).monospacedDigit())
                .foregroundStyle(Palette.text3)
                .frame(width: 32, alignment: .leading)
            mark.frame(width: 12)
            if step.key == true {
                Image(systemName: "star.fill")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(step.done ? Palette.text3 : Palette.gold)
            }
            Text(step.title)
                .font(.system(size: 13))
                .strikethrough(step.done, color: Palette.text3)
                .foregroundStyle(step.done ? Palette.text3 : Palette.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .privacySensitive()
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var mark: some View {
        if step.done {
            Image(systemName: "checkmark")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Palette.text3)
        } else if step.kind == "training" {
            Image(systemName: "figure.run")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Palette.category("training"))
        } else if step.kind == "sprint" {
            Image(systemName: "list.bullet")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(Palette.gold)
        } else {
            Circle()
                .fill(Palette.category(step.category))
                .frame(width: 7, height: 7)
        }
    }
}

// where you are: the time, and a gold rule across, as on Ledger's Flow
private struct NowLine: View {
    let date: Date
    var body: some View {
        HStack(spacing: 8) {
            Text(flowHHMM(date))
                .font(.system(size: 10, weight: .semibold).monospacedDigit())
                .foregroundStyle(Palette.gold)
                .frame(width: 32, alignment: .leading)
            Circle()
                .fill(Palette.gold)
                .frame(width: 6, height: 6)
                .frame(width: 12)
            Rectangle()
                .fill(Palette.gold.opacity(0.6))
                .frame(height: 1)
        }
        .widgetAccentable()
        .padding(.vertical, 3)
    }
}

private struct FlowMessage: View {
    let signedOut: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("FLOW")
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(Palette.text3)
            Spacer(minLength: 0)
            Text(signedOut ? "Sign in to Ledger" : "Open Ledger")
                .font(.system(.title3, design: .serif))
                .foregroundStyle(Palette.text)
            Text(signedOut ? "Your Flow appears here" : "to see today's Flow")
                .font(.caption)
                .foregroundStyle(Palette.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview(as: .systemMedium) {
    FlowWidget()
} timeline: {
    FlowEntry(date: .now, snapshot: .preview)
}

#Preview(as: .systemLarge) {
    FlowWidget()
} timeline: {
    FlowEntry(date: .now, snapshot: .preview)
}
