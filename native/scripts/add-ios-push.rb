# Phase 2 (notifications): adds GoogleService-Info.plist to the iOS app, and a build step that
# stops with a clear message when it hasn't been copied in. The file is the Firebase app's
# configuration (like the web config in index.html, not a secret), downloaded from the
# Firebase Console; it is kept out of the repository (.gitignore) and copied in on the Mac.
# Run once; it refuses to run twice.
#
#   gem install xcodeproj
#   ruby native/scripts/add-ios-push.rb
require 'xcodeproj'

root = File.expand_path('../ios/App', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'App.xcodeproj'))
app = project.targets.find { |t| t.name == 'App' } or abort 'no App target'
abort 'GoogleService-Info.plist is already in the project' if app.resources_build_phase.files_references.any? { |r| r && r.path == 'GoogleService-Info.plist' }
app_group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' } or abort 'no App group'

app.resources_build_phase.add_file_reference(app_group.new_reference('GoogleService-Info.plist'))

check = app.new_shell_script_build_phase('Check GoogleService-Info.plist')
check.shell_script = <<~SH
  if [ ! -f "${SRCROOT}/App/GoogleService-Info.plist" ]; then
    echo "error: Copy GoogleService-Info.plist (Firebase Console > Project settings > Your apps > Ledger iOS) into native/ios/App/App/ - see native/README.md."
    exit 1
  fi
SH
check.show_env_vars_in_log = '0'
# before anything is compiled
app.build_phases.move(check, 0)

project.save
puts 'Added GoogleService-Info.plist and its check to the App target.'
