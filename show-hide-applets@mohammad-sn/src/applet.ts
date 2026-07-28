const Applet = imports.ui.applet;
const Lang = imports.lang;
const Gtk = imports.gi.Gtk;
const Pixbuf = imports.gi.GdkPixbuf.Pixbuf;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const gettext = imports.gettext;
type StatusIconInterfaceProxy = imports.gi.XApp.StatusIconInterfaceProxy;
const Gio = imports.gi.Gio;

const UUID = "show-hide-applets@mohammad-sn";
gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

// 7 days, since some apps use multiple distinct icons but only one at the time. It's not possible to identify correlated icons by app name (multiple apps can have the same name), so users unfortunately sometimes have to toggle different icon states "on" if that is an app that they always want to see.
const ICON_SWITCH_STORE_DURATION = 7 * 24 * 60 * 60 * 1000;

function _(str: string): string {
  return gettext.dgettext(UUID, str);
}

// Applet doesn't declare locationLabel, but actually writes to it:
// https://github.com/linuxmint/cinnamon/blob/master/js/ui/applet.js
declare global {
  namespace imports.ui.applet {
    interface IconApplet {
      locationLabel: string;
    }
  }
}

// function listAllProps(obj: any): string[] {
//   const seen = new Set();
//   const out = [];

//   while (obj && obj !== Object.prototype) {
//     for (const name of Object.getOwnPropertyNames(obj)) {
//       if (!seen.has(name)) {
//         seen.add(name);
//         out.push(name);
//       }
//     }
//     obj = Object.getPrototypeOf(obj);
//   }

//   return out;
// }

/**
 * Polyfill for GLib.timeout_add_once (not in Cinnamon 6.6.9's GLib version).
 * Calls `callback` once after `interval` milliseconds, then removes the source.
 */
function timeout_add_once(interval: number, callback: () => void): number {
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
    callback();
    return GLib.SOURCE_REMOVE;
  });
}

/**
 * Polyfill for timeout_add_seconds_once (not in Cinnamon 6.6.9's GLib version).
 * Calls `callback` once after `interval` seconds, then removes the source.
 */
function timeout_add_seconds_once(interval: number, callback: () => void): number {
  return GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
    callback();
    return GLib.SOURCE_REMOVE;
  });
}

class MyApplet extends Applet.IconApplet {
  settings!: imports.ui.settings.AppletSettings;
  orientation: imports.gi.St.Side;
  applet_path: string;

  // Settings-bound properties
  do_autohide!: boolean;
  disable_starttime_autohide!: boolean;
  hover_activates!: boolean;
  hover_activates_hide!: boolean;
  hide_time!: number;
  hover_time!: number;
  autohideReshowing!: boolean;
  autohideReshowingTime!: number;
  hide_until_separator!: boolean;

  // Runtime state
  do_hide!: boolean;
  alreadyHidden!: imports.gi.Clutter.Actor[];
  last_toggle_hiding_end!: number;
  last_toggle_hiding_start!: number;
  loadedPanel!: imports.ui.panel.Panel;
  monitor!: imports.gi.XApp.StatusIconMonitor;
  signal_manager!: imports.misc.signalManager.SignalManager;
  icons_dir!: imports.gi.Gio.File;
  icons: Record<
    string,
    {
      ownerUuid: string;
      name: string;
      last_seen: number;
      show: boolean;

      icon_name?: string;
    }
  > = {};

  // Menu items
  menu_item_auto_hide!: imports.ui.popupMenu.PopupSwitchMenuItem;
  menu_item_panel_edit_mode!: imports.ui.popupMenu.PopupSwitchMenuItem;
  menu_items_icon_section: imports.ui.popupMenu.PopupMenuSection | undefined;

  // Connected signals
  connected_on_panel_edit_mode_changed: number | undefined;
  connected_on_entered: number | undefined;
  connected_on_allocation_changed: number | undefined;

  // Timeout IDs
  _hideTimeoutId: number | null = null;
  _reshowingHideTimeoutId: number | null = null;
  _updateIconsTimeoutId: number | null = null;
  _updatePopupMenuTimeoutId: number | null = null;

  constructor(
    metadata: any,
    orientation: imports.gi.St.Side,
    panel_height: number,
    instance_id: number,
  ) {
    super(orientation, panel_height, instance_id);

    this.orientation = orientation;
    this.applet_path = metadata.path;
    this._hideTimeoutId = null;
    this._reshowingHideTimeoutId = null;
    this._updateIconsTimeoutId = null;
    this.last_toggle_hiding_start = 0;
    this.last_toggle_hiding_end = 0;
    this.do_hide = true;
    this.alreadyHidden = [];

    try {
      this.settings = new Settings.AppletSettings(
        this,
        "devtest-show-hide-applets@mohammad-sn",
        this.instance_id,
      );
      this.icons = this.settings.getValue("icons");

      Gtk.IconTheme.get_default().append_search_path(this.applet_path);
      this.icons_dir = Gio.File.new_for_path(this.applet_path + "/icons");
      if (!this.icons_dir.query_exists(null)) {
        this.icons_dir.make_directory_with_parents(null);
      }
      Gtk.IconTheme.get_default().append_search_path(this.icons_dir.get_path() as string);

      this.loadedPanel = this.panel!;

      this.update_our_icon();
      this.bind_settings();
      this.update_autohide_tooltip();

      this.connected_on_panel_edit_mode_changed = global.settings.connect(
        "changed::panel-edit-mode",
        Lang.bind(this, this.on_panel_edit_mode_changed),
      );

      this.connected_on_entered = this.actor.connect(
        // "enter-event" works but I can't find it in the cinnamon repo: https://github.com/search?q=repo%3Alinuxmint%2Fcinnamon%20enter-event&type=code
        // @ts-expect-error
        "enter-event",
        Lang.bind(this, this.on_entered),
      );

      // Initial populate + start periodic updaters
      timeout_add_seconds_once(1, () => {
        this.update_icons();
        this.update_popup_menu();
        this.start_periodic_updaters();
      });

      this.connected_on_allocation_changed = this.get_our_panel_zone().connect(
        "allocation-changed",
        () => {
          this.on_allocation_changed();
        },
      );

      if (this.do_autohide) {
        this._hideTimeoutId = timeout_add_seconds_once(this.hide_time, () => {
          this._hideTimeoutId = null;
          this.auto_hide();
        });
      }
    } catch (e) {
      global.logError(e);
    }
  }

  auto_hide() {
    // another `auto_hide` is already scheduled
    if (this._hideTimeoutId || !this.do_autohide) {
      return;
    }

    // postpone auto hide if any of the eligible applets are hovered or have an active menu
    let postpone = this.actor.hover && this.hover_activates;
    let children = this.get_zone_children();
    let p = children.indexOf(this.actor);
    for (let i = 0; i < p; i++) {
      postpone = postpone || children[i].hover;
      if (children[i]._applet._menuManager)
        postpone = postpone || children[i]._applet._menuManager._activeMenu;
      if (children[i]._applet.menuManager)
        postpone = postpone || children[i]._applet.menuManager._activeMenu;
      if (postpone) break;
    }
    if (postpone) {
      this._hideTimeoutId = timeout_add_seconds_once(this.hide_time, () => {
        this._hideTimeoutId = null;
        this.auto_hide();
      });
    } else if (this.do_hide && !global.settings.get_boolean("panel-edit-mode")) {
      this.toggle_hiding();
    }
  }

  bind_settings() {
    try {
      this.settings.bindProperty(
        Settings.BindingDirection.BIDIRECTIONAL,
        "do_autohide",
        "do_autohide",
        () => {
          if (this._hideTimeoutId && !this.do_autohide) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = null;
          } else if (this.do_autohide && this.do_hide) {
            this.auto_hide();
          }

          if (this.menu_item_auto_hide) {
            this.menu_item_auto_hide["_switch"].setToggleState(this.do_autohide);
          }

          this.update_autohide_tooltip();
        },
        null,
      );
      this.settings.bindProperty(Settings.BindingDirection.IN, "hoveractivates", "hover_activates");
      this.settings.bindProperty(
        Settings.BindingDirection.IN,
        "hoveractivateshide",
        "hover_activates_hide",
      );
      this.settings.bindProperty(Settings.BindingDirection.IN, "hidetime", "hide_time");
      this.settings.bindProperty(Settings.BindingDirection.IN, "hovertime", "hover_time");
      this.settings.bindProperty(
        Settings.BindingDirection.IN,
        "autohiders",
        "autohideReshowing",
        () => {
          this.refresh_if_hidden();
        },
        null,
      );
      this.settings.bindProperty(
        Settings.BindingDirection.IN,
        "hideuntilseparator",
        "hide_until_separator",
      );
    } catch (e) {
      global.logError(e);
    }
  }

  ensure_local_icon(icon_name: string) {
    if (!icon_name.includes("/")) {
      return icon_name;
    }

    const is_ico = icon_name.endsWith(".ico");
    const dest_name = is_ico
      ? icon_name.replace(/\//g, "@").replace(/\.ico$/, ".png")
      : icon_name.replace(/\//g, "@");
    const dest_file = this.icons_dir.get_child(dest_name);
    if (!dest_file.query_exists(null)) {
      const source_file = Gio.File.new_for_path(icon_name);
      if (!source_file.query_exists(null)) {
        return undefined;
      }

      if (is_ico) {
        const pixbuf = Pixbuf.new_from_file(icon_name);
        pixbuf!.savev(dest_file.get_path()!.replace(/\.ico$/, ".png"), "png", null, null);
      } else {
        source_file.copy(dest_file, Gio.FileCopyFlags.NONE, null, null);
      }
    }

    // Get rid of the extension
    return dest_name.replace(/\.[^.]+$/, "");
  }

  get_eligible_children() {
    let children = this.get_zone_children();
    let ourIndex = children.indexOf(this.actor);
    let eligible: any = [];

    if (this.do_hide) {
      for (let i = ourIndex - 1; i > -1; i--) {
        if (this.hide_until_separator && children[i]._applet._uuid == "separator@cinnamon.org") {
          break;
        }

        eligible.push(children[i]);
      }
    } else {
      for (let i = 0; i < ourIndex; i++) {
        eligible.push(children[i]);
      }
    }

    return eligible;
  }

  get_our_panel_zone() {
    if (this.locationLabel === "right") return this.loadedPanel["_rightBox"];
    else if (this.locationLabel === "left") return this.loadedPanel["_leftBox"];
    else return this.loadedPanel["_centerBox"];
  }

  // logs say these children are `StBoxLayout` but `StBoxLayout` type has `no _applet`, even though it exists...
  // So we return `any`, even though it should be `StBoxLayout`.
  get_zone_children() {
    return (this.get_our_panel_zone() as imports.gi.Clutter.Actor).get_children() as any;
  }

  is_vertical() {
    return this.orientation == St.Side.LEFT || this.orientation == St.Side.RIGHT;
  }

  // This is mostly about the xapps icon tray regularly "showing" its icons.
  on_allocation_changed() {
    global.log("on_allocation_changed");

    // Event was probably triggered by us.
    // While this currently wouldn't result in an infinite loop, it's probably a good idea to ignore events that are triggered by us changing the panel content.
    const now = GLib.get_monotonic_time();
    if (
      // 50ms
      now - this.last_toggle_hiding_end < 50_000 ||
      now - this.last_toggle_hiding_start < 50_000
    ) {
      return;
    }

    if (this.autohideReshowing) {
      this.refresh_if_hidden();
    }
  }

  on_applet_clicked() {
    this.toggle_hiding();
    return true;
  }

  on_applet_removed_from_panel() {
    if (!this.do_hide) {
      this.toggle_hiding();
    }

    // Disconnect all signals
    if (this.connected_on_panel_edit_mode_changed) {
      global.settings.disconnect(this.connected_on_panel_edit_mode_changed);
    }
    if (this.connected_on_entered) {
      this.actor.disconnect(this.connected_on_entered);
    }
    if (this.connected_on_allocation_changed) {
      this.get_our_panel_zone().disconnect(this.connected_on_allocation_changed);
    }

    // Remove all timeouts
    for (const id of [
      this._updateIconsTimeoutId,
      this._updatePopupMenuTimeoutId,
      this._reshowingHideTimeoutId,
      this._hideTimeoutId,
    ]) {
      if (id) GLib.source_remove(id);
    }
  }

  on_applet_middle_clicked() {
    this.do_autohide = !this.do_autohide;
    if (this.menu_item_auto_hide) {
      this.menu_item_auto_hide["_switch"].setToggleState(this.do_autohide);
    }
    this.toggle_hiding();
    return true;
  }

  on_entered() {
    if (
      !this.actor.hover &&
      this.hover_activates &&
      !global.settings.get_boolean("panel-edit-mode")
    ) {
      timeout_add_once(this.hover_time, () => {
        if (this.actor.hover && (this.hover_activates_hide || !this.do_hide)) {
          this.toggle_hiding();
        }
      });
    }
  }

  on_panel_edit_mode_changed() {
    this.menu_item_panel_edit_mode.setToggleState(global.settings.get_boolean("panel-edit-mode"));
    if (global.settings.get_boolean("panel-edit-mode")) {
      if (!this.do_hide) {
        this.toggle_hiding();
      }
    } else if (this.do_hide) {
      this.toggle_hiding();
    }
  }

  on_orientation_changed(orientation: imports.gi.St.Side) {
    this.orientation = orientation;
  }

  refresh_if_hidden() {
    if (!this.do_hide) {
      this.do_hide = true;
      this.toggle_hiding(true);
    }
  }

  reset_icons() {
    this._applet_context_menu.close(false);

    const iconsBackup = JSON.parse(JSON.stringify(this.icons)) as typeof this.icons;
    this.icons = {};
    this.update_icons();
    // Restore `show` status
    Object.entries(iconsBackup).forEach(([key, { show }]) => {
      if (this.icons[key]) {
        this.icons[key].show = show;
      }
    });

    this.update_popup_menu();
    this.refresh_if_hidden();

    // Wait for external close event to be processed before opening the menu again
    timeout_add_once(10, () => {
      this._applet_context_menu.open(false);
    });
  }

  start_periodic_updaters() {
    this._updateIconsTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
      this.update_icons();
      return GLib.SOURCE_CONTINUE;
    });

    this._updatePopupMenuTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
      this.update_popup_menu();
      return GLib.SOURCE_CONTINUE;
    });
  }

  toggle_hiding(refreshing: boolean = false) {
    try {
      if (this._hideTimeoutId) {
        GLib.source_remove(this._hideTimeoutId);
        this._hideTimeoutId = null;
      }

      this.last_toggle_hiding_start = GLib.get_monotonic_time();
      this.update_our_icon();

      if (this.do_hide && !refreshing) {
        this.alreadyHidden = [];
      }

      for (const child of this.get_eligible_children()) {
        const applet = child._applet;

        if (this.do_hide) {
          if (this.hide_until_separator && applet._uuid == "separator@cinnamon.org") {
            break;
          }

          if (applet._uuid == "systray@cinnamon.org") {
            for (const systrayChild of child.get_first_child().get_children()) {
              const icon = systrayChild.get_child();

              if (!systrayChild.visible && !refreshing) {
                this.alreadyHidden.push(systrayChild);
              }

              const key = applet._uuid + icon.title;
              if (this.icons[key] && this.icons[key].show) {
                continue;
              }

              systrayChild.hide();
            }
            continue;
          }

          if (applet._uuid === "xapp-status@cinnamon.org") {
            for (const xappChild of Object.values(applet.statusIcons as Record<string, any>)) {
              const { name, icon_name, visible } = xappChild.proxy as StatusIconInterfaceProxy;

              if (!visible && !refreshing) {
                this.alreadyHidden.push(xappChild);
              }

              const key = applet._uuid + name + icon_name;
              if (this.icons[key] && this.icons[key].show) {
                continue;
              }

              xappChild.actor.hide();
            }
            continue;
          }

          // Keep track of applets (not necessarily individual icons) that were already hidden, not by us.
          if (!child.visible && !refreshing) {
            this.alreadyHidden.push(child);
          }

          const { uuid, name, icon } = applet._meta;
          const key = uuid + name + icon;
          if (this.icons[key] && this.icons[key].show) {
            continue;
          }
          child.hide();
        } else {
          // Don't show icons that were already hidden by external code.
          // This also covers the case where one of them switches visibility and triggers an allocation_changed event => if it was known as previously hidden, we don't hide it. Which is generally what you want with icons that switch between hidden and visible by themselves.
          if (!this.alreadyHidden.includes(child)) {
            child.show();
          }

          if (applet._uuid === "systray@cinnamon.org") {
            try {
              for (const systrayChild of child.get_first_child().get_children()) {
                if (!this.alreadyHidden.includes(systrayChild)) {
                  systrayChild.show();
                }
              }
            } catch (e) {
              global.logError(e);
            }
          }

          if (applet._uuid === "xapp-status@cinnamon.org") {
            for (const xappChild of Object.values(applet.statusIcons as Record<string, any>)) {
              const { name, icon_name } = xappChild.proxy as StatusIconInterfaceProxy;
              if (
                name.trim() !== "" &&
                icon_name.trim() !== "" &&
                !this.alreadyHidden.includes(xappChild)
              ) {
                xappChild.actor.show();
              }
            }
          }
        }
      }

      if (!this.do_hide && this.do_autohide && !global.settings.get_boolean("panel-edit-mode")) {
        this._hideTimeoutId = timeout_add_seconds_once(this.hide_time, () => {
          this._hideTimeoutId = null;
          this.auto_hide();
        });
      }

      global.log("Toggling hiding: " + this.do_hide + " -> " + !this.do_hide);
      this.do_hide = !this.do_hide;
      this.last_toggle_hiding_end = GLib.get_monotonic_time();
    } catch (e) {
      global.logError(e);
    }
  }

  update_autohide_tooltip() {
    if (this.do_autohide) this.set_applet_tooltip(_("Autohide ON"));
    else this.set_applet_tooltip(_("Autohide OFF"));
  }

  update_icons() {
    for (const childBoxLayout of this.get_eligible_children()) {
      const applet = childBoxLayout._applet as any;
      if (applet._uuid === "separator@cinnamon.org") {
        continue;
      } else if (applet._uuid === "xapp-status@cinnamon.org") {
        // `applet` is a CinnamonXAppStatusApplet:
        // https://github.com/linuxmint/cinnamon/blob/master/files/usr/share/cinnamon/applets/xapp-status%40cinnamon.org/applet.js#L391C6-L391C32
        Object.values(applet.statusIcons as Record<string, any>).forEach((icon) => {
          // `icon` is a XAppStatusIcon, NOT imports.gi.XApp.StatusIcon
          // https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/files/usr/share/cinnamon/applets/xapp-status%40cinnamon.org/applet.js#L106
          // Object.keys(icon):
          // name, applet, proxy, iconName, actor, icon_holder, iconSize, label, _tooltip, _proxy_prop_change_id, show_label
          const { name, icon_name } = icon.proxy as StatusIconInterfaceProxy;

          // xapp-status@cinnamon.org only renders proxies that have a name AND icon_name! (But icon_name seems to be a space when it's "empty".)
          if (name.trim() === "" || icon_name.trim() === "") {
            return;
          }

          const key = applet._uuid + name + icon_name;
          this.icons[key] ??= {
            ownerUuid: applet._uuid,
            name,
            icon_name: icon_name ? this.ensure_local_icon(icon_name) : undefined,
            last_seen: Date.now(),
            show: false,
          };
          this.icons[key].last_seen = Date.now();
        });
      } else if (applet._uuid === "systray@cinnamon.org") {
        // It's typeof St.Bin[], the buttons created here: https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/files/usr/share/cinnamon/applets/systray%40cinnamon.org/applet.js#L147
        for (const systrayIcon of childBoxLayout.get_first_child().get_children() as any) {
          // CinnamonTrayIcon: https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/src/cinnamon-tray-icon.c#L20
          const icon = systrayIcon.get_child();
          const key = applet._uuid + icon.title;
          // We have no names/paths of the icons themselves here
          this.icons[key] ??= {
            ownerUuid: applet._uuid,
            name: icon.title,
            last_seen: Date.now(),
            show: false,
          };
          this.icons[key].last_seen = Date.now();
        }
      } else {
        // `applet._meta` shape:
        // {"uuid":"network@cinnamon.org","name":"Network Manager","description":"Network manager applet","icon":"cs-network","state":1,"path":"/usr/share/cinnamon/applets/network@cinnamon.org","error":"","force_loaded":false}
        const { uuid, name, icon } = applet._meta;
        const key = uuid + name + icon;
        this.icons[key] ??= {
          ownerUuid: uuid,
          name,
          icon_name: icon,
          last_seen: Date.now(),
          show: false,
        };
        this.icons[key].last_seen = Date.now();
      }
    }

    Object.entries(this.icons).forEach(([key, icon]) => {
      if (Date.now() - icon.last_seen > ICON_SWITCH_STORE_DURATION) {
        delete this.icons[key];
      }
    });

    // Make sure xapp-status@cinnamon.org icons are at the bottom of the list.
    const iconValues = Object.values(this.icons);
    if (
      iconValues[0]?.ownerUuid === "xapp-status@cinnamon.org" &&
      iconValues[iconValues.length - 1]?.ownerUuid !== "xapp-status@cinnamon.org"
    ) {
      this.icons = Object.fromEntries(Object.entries(this.icons).reverse());
    }

    this.settings.setValue("icons", this.icons);
  }

  update_our_icon() {
    if (this.do_hide) {
      if (this.is_vertical()) {
        this.set_applet_icon_symbolic_name("2v");
      } else {
        this.set_applet_icon_symbolic_name("2");
      }
    } else {
      if (this.is_vertical()) {
        this.set_applet_icon_symbolic_name("1v");
      } else {
        this.set_applet_icon_symbolic_name("1");
      }
    }
  }

  update_popup_menu() {
    global.log("update_popup_menu");
    if (!this._applet_context_menu.isOpen) {
      if (!this.menu_items_icon_section) {
        this.menu_items_icon_section = new PopupMenu.PopupMenuSection();

        this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 0);
        this._applet_context_menu.addMenuItem(this.menu_items_icon_section, 0);
        this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 0);

        const menu_item_reset_icons_list = new PopupMenu.PopupMenuItem(_("Reset icons list"));
        menu_item_reset_icons_list.connect("activate", () => {
          this.reset_icons();
        });
        this._applet_context_menu.addMenuItem(menu_item_reset_icons_list, 0);

        this.menu_item_panel_edit_mode = new PopupMenu.PopupSwitchMenuItem(
          _("Panel Edit mode"),
          global.settings.get_boolean("panel-edit-mode"),
        );
        this.menu_item_panel_edit_mode.connect("toggled", function (item) {
          global.settings.set_boolean("panel-edit-mode", item.state);
        });
        this._applet_context_menu.addMenuItem(this.menu_item_panel_edit_mode, 0);

        this.menu_item_auto_hide = new PopupMenu.PopupSwitchMenuItem(
          _("Autohide"),
          this.do_autohide,
        );
        this.menu_item_auto_hide.connect("toggled", () => {
          this.do_autohide = !this.do_autohide;
          this.update_autohide_tooltip();
        });
        this._applet_context_menu.addMenuItem(this.menu_item_auto_hide, 0);
      }

      this.menu_items_icon_section.removeAll();
      Object.entries(this.icons).forEach(([key, { name, show, icon_name }]) => {
        const iconToggle = icon_name
          ? new PopupMenu.PopupSwitchIconMenuItem(
              name,
              show,
              icon_name,
              icon_name!.includes("/") ? St.IconType.FULLCOLOR : St.IconType.SYMBOLIC,
            )
          : new PopupMenu.PopupSwitchMenuItem(name, show);
        // @ts-expect-error
        iconToggle.connect("toggled", () => {
          this.icons[key].show = !this.icons[key].show;
          this.settings.setValue("icons", this.icons);

          // Refresh if currently hidden
          if (!this.do_hide) {
            this.toggle_hiding();
            this.toggle_hiding();
          }
        });
        this.menu_items_icon_section!.addMenuItem(iconToggle);
      });
    }
  }
}

export function main(
  metadata: any,
  orientation: imports.gi.St.Side,
  panel_height: number,
  instance_id: number,
): MyApplet {
  let myApplet = new MyApplet(metadata, orientation, panel_height, instance_id);
  return myApplet;
}
