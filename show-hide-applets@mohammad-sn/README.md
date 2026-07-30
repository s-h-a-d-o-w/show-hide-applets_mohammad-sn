This applet hides applets to the left of it, within the same zone. (Or on top with vertical panels.)

By default, Cinnamon tends to add it on the very left of the right zone, so **it is essential** to enter the panel edit mode and move it to the right of what you want to hide!

Many tray icons result in the toggle menu getting cut off instead of being scrollable. This bug [has already been reported](https://github.com/linuxmint/cinnamon/issues/13908).

Tray icons for notifications are shockingly fragile. If you do something with this applet that makes them disappear, just make sure to turn their toggles on and they should reappear within a minute or two.

### Specific contributions wanted

1. Getting icon data (icon name or path) out of `systray@cinnamon.org`, so that we can show that icon in the popup menu.
2. Somehow getting nicer names for icons would be great, particuarly for apps like Deezer that somehow don't provide anything readable to the Xapp Status Applet. The associated process name would probably be best.

### Thanks to

- [@Gr3q](https://github.com/Gr3q) for publishing [@ci-types/cjs](https://www.npmjs.com/package/@ci-types/cjs) which made it possible to use TypeScript for applets.
- [@kriegcc](https://github.com/kriegcc) for [this applet](https://github.com/linuxmint/cinnamon-spices-applets/tree/master/fish%40kriegcc) that first made me aware of the just mentioned types in the first place.
