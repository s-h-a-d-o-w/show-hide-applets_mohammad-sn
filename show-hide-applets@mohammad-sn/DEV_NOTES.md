## v1.0.0

### Changes

- Switched "Autohide reshowing applets" to `false` by default because it might interfere with system icons that only show sometimes, like e.g. Spices Update.
- Switched "hide until separator" to `true` by default because I'm guessing that people aren't going to have separate us randomly among their tray icons before installing this applet. If they have one there, it's probably to work in conjunction with this applet. And if there isn't one, this obviously doesn't do anything anyway.

### Notes

- Given that the xapps icon tray regularly shows its icons, I'm not sure whether it even makes sense to expose "autohide reshowing" to users. Because it seems to me that because of this, disabling the option would result in broken functionality. Users wouldn't understand why icons keep showing for no reason, maybe think that this applet is buggy.
- "Reshowing applets" are actually problematic because for some reason, _all_ icons in the xapps icon applet regularly reappear. But then there are also individual icons that become visible only when the user should be notified about something. Telling the difference between these two can't be reliable. Because even if we check whether only one icon newly became visible - if there is only one icon in the xapps icon applet, this would trigger as well. But since that's probably an unlikely scenario, I went with automatically hiding only if more than one icon switches to visible. In the scenario where a user only has one icon in the xapps icon applet - why would they use this applet here anyway?
