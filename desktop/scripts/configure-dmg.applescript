on run argv
  set volumeName to item 1 of argv

  tell application "Finder"
    tell disk volumeName
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set pathbar visible of container window to false
      set sidebar width of container window to 0
      set bounds of container window to {120, 120, 780, 540}

      set iconOptions to icon view options of container window
      set arrangement of iconOptions to not arranged
      set icon size of iconOptions to 112
      set text size of iconOptions to 13
      set label position of iconOptions to bottom
      set background picture of iconOptions to file ".background:dmg-background.png"

      set position of item "Aval.app" of container window to {175, 194}
      set position of item "Applications" of container window to {485, 194}

      update without registering applications
      delay 2
      close container window
      open
      delay 2
      close container window
    end tell
  end tell
end run
