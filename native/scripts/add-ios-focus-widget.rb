# Adds the Focus widget's source (LedgerWidget/FocusWidget.swift) to the LedgerWidget target,
# the way dragging it into Xcode with that target ticked would. Run once; it refuses to run
# twice.
#
#   gem install xcodeproj
#   ruby native/scripts/add-ios-focus-widget.rb
require 'xcodeproj'

root = File.expand_path('../ios/App', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'App.xcodeproj'))
widget = project.targets.find { |t| t.name == 'LedgerWidget' } or abort 'no LedgerWidget target'
abort 'FocusWidget.swift is already in LedgerWidget' if widget.source_build_phase.files_references.any? { |r| r && r.path == 'FocusWidget.swift' }
group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'LedgerWidget' } or abort 'no LedgerWidget group'
widget.source_build_phase.add_file_reference(group.new_reference('FocusWidget.swift'))
project.save
puts 'Added FocusWidget.swift to the LedgerWidget target.'
