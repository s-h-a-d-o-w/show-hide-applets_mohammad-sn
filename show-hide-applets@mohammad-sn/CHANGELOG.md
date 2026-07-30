## v1.0.0

Overall revamping aside...

- Switched "autohide reshowing applets" to `false` by default because it might interfere with system icons that only show sometimes, like e.g. Spices Update.
- Switched "hide until separator" to `true` by default because I'm guessing that people aren't going to have separate us randomly among their tray icons before installing this applet. If they have one there, it's probably to work in conjunction with this applet. And if there isn't one, this obviously doesn't do anything anyway.
- Use `allocation-changed` instead of `queue-relayout` because the latter fires even on mouse hovers across the icons. `allocation-changed` on the other hand pretty much only changes when icons either appear or are removed.
