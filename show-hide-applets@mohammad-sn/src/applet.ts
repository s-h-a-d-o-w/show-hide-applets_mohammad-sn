const Applet = imports.ui.applet;
const Lang = imports.lang;
const Gtk = imports.gi.Gtk;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const gettext = imports.gettext;
const XApp = imports.gi.XApp;
type StatusIcon = imports.gi.XApp.StatusIcon;
type StatusIconInterfaceProxy = imports.gi.XApp.StatusIconInterfaceProxy;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;

const UUID = "show-hide-applets@mohammad-sn";
gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

const ICON_SWITCH_STORE_DURATION = 5 * 60 * 1000; // 5 minutes

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

function listAllProps(obj: any): string[] {
  const seen = new Set();
  const out = [];

  while (obj && obj !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(obj)) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    obj = Object.getPrototypeOf(obj);
  }

  return out;
}

class MyApplet extends Applet.IconApplet {
  settings!: imports.ui.settings.AppletSettings;
  orientation: imports.gi.St.Side;
  _hideTimeoutId: number | null;
  _reshowingHideTimeoutId: number | null;

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
  loadedPanel!: imports.ui.panel.Panel;
  monitor!: imports.gi.XApp.StatusIconMonitor;
  signal_manager!: imports.misc.signalManager.SignalManager;
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

  constructor(
    metadata: any,
    orientation: imports.gi.St.Side,
    panel_height: number,
    instance_id: number,
  ) {
    super(orientation, panel_height, instance_id);

    this.orientation = orientation;
    this._hideTimeoutId = null;
    this._reshowingHideTimeoutId = null;

    try {
      Gtk.IconTheme.get_default().append_search_path(metadata.path);
      if (this.is_vertical()) this.set_applet_icon_symbolic_name("1v");
      else this.set_applet_icon_symbolic_name("1");

      this.loadedPanel = this.panel!;

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

      this.do_hide = true;
      this.alreadyHidden = [];
      if (!this.disable_starttime_autohide || this.do_autohide) {
        // @ts-expect-error timeout_add_seconds Type is wrong
        this._hideTimeoutId = Mainloop.timeout_add_seconds(
          2,
          Lang.bind(this, function (this: MyApplet) {
            if (this.do_hide) this.auto_hide();
          }),
        );
      }

      if (this._reshowingHideTimeoutId) {
        Mainloop.source_remove(this._reshowingHideTimeoutId);
        this._reshowingHideTimeoutId = null;
      }

      Mainloop.timeout_add_seconds(
        1,
        Lang.bind(this, function (this: MyApplet) {
          this.update_icons();
          this.update_popup_menu();
        }),
      );

      // TODO: evaluate whether we actually need "queue-relayout" for the more exotic features, like maybe not hiding an icon when it is being hovered. At least I think that's one of the things being done.
      this.connected_on_allocation_changed = this.get_our_panel_zone().connect(
        "allocation-changed",
        () => {
          this.on_allocation_changed();
        },
      );
    } catch (e) {
      global.logError(e);
    }
  }

  auto_hide() {
    // another `auto_hide` is already scheduled
    if (this._hideTimeoutId) {
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
      // @ts-expect-error timeout_add_seconds Type is wrong
      this._hideTimeoutId = Mainloop.timeout_add_seconds(
        this.hide_time,
        Lang.bind(this, function (this: MyApplet) {
          this.auto_hide();
        }),
      );
    } else if (this.do_hide && !global.settings.get_boolean("panel-edit-mode")) {
      this.toggle_hiding();
    }
  }

  bind_settings() {
    this.settings = new Settings.AppletSettings(
      this,
      "devtest-show-hide-applets@mohammad-sn",
      this.instance_id,
    );

    this.settings.bindProperty(
      Settings.BindingDirection.BIDIRECTIONAL,
      "do_autohide",
      "do_autohide",
      Lang.bind(this, function (this: MyApplet) {
        if (this._hideTimeoutId && !this.do_autohide) {
          Mainloop.source_remove(this._hideTimeoutId);
          this._hideTimeoutId = null;
        } else if (this.do_autohide && this.do_hide) this.auto_hide();

        if (this.menu_item_auto_hide) {
          this.menu_item_auto_hide["_switch"].setToggleState(this.do_autohide);
        }

        this.update_autohide_tooltip();
      }),
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "disablestarttimeautohide",
      "disable_starttime_autohide",
      function () { },
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hoveractivates",
      "hover_activates",
      function () { },
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hoveractivateshide",
      "hover_activates_hide",
      function () { },
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hidetime",
      "hide_time",
      function () { },
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hovertime",
      "hover_time",
      function () { },
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "autohiders",
      "autohideReshowing",
      Lang.bind(this, function (this: MyApplet) {
        if (!this.do_hide) {
          this.toggle_hiding();
          this.auto_hide();
        }
      }),
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "autohiderstime",
      "autohideReshowingTime",
      function (this: MyApplet) { },
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hideuntilseparator",
      "hide_until_separator",
      function (this: MyApplet) { },
      null,
    );
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

  on_allocation_changed() {
    // global.log("allocation-changed");
    if (this.autohideReshowing && !this.do_hide) {
      // @ts-expect-error timeout_add_seconds Type is wrong
      this._reshowingHideTimeoutId = Mainloop.timeout_add_seconds(
        this.autohideReshowingTime,
        Lang.bind(this, function (this: MyApplet) {
          if (!this.do_hide) {
            this.toggle_hiding();
            this.auto_hide();
          }
          return false;
        }),
      );
    }
  }

  on_applet_clicked() {
    this.toggle_hiding();
    return true;
  }

  on_entered() {
    if (
      !this.actor.hover &&
      this.hover_activates &&
      !global.settings.get_boolean("panel-edit-mode")
    )
      Mainloop.timeout_add(
        this.hover_time,
        Lang.bind(this, function (this: MyApplet) {
          if (this.actor.hover && (this.hover_activates_hide || !this.do_hide))
            this.toggle_hiding();
        }),
      );
  }

  on_applet_removed_from_panel() {
    global.log("on_applet_removed_from_panel");
    if (!this.do_hide) {
      this.toggle_hiding();
    }

    if (this.connected_on_panel_edit_mode_changed) {
      global.settings.disconnect(this.connected_on_panel_edit_mode_changed);
    }

    if (this.connected_on_entered) {
      this.actor.disconnect(this.connected_on_entered);
    }

    if (this.connected_on_allocation_changed) {
      this.get_our_panel_zone().disconnect(this.connected_on_allocation_changed);
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

  toggle_hiding() {
    if (this._hideTimeoutId) {
      Mainloop.source_remove(this._hideTimeoutId);
      this._hideTimeoutId = null;
    }

    this.update_our_icon();

    for (const child of this.get_eligible_children()) {
      const applet = child._applet;

      if (this.do_hide) {
        this.alreadyHidden = [];

        // Keep track of applets (not necessarily individual icons) that were already hidden, not by us.
        if (!child.visible) {
          this.alreadyHidden.push(child);
        }

        if (applet._uuid == "systray@cinnamon.org") {
          for (const j of child.get_first_child().get_children()) {
            const icon = j.get_child();
            const key = applet._uuid + icon.title
            if (this.icons[key] && this.icons[key].show) {
              continue;
            }

            j.hide();
          }
          continue;
        } else if (
          this.hide_until_separator &&
          applet._uuid == "separator@cinnamon.org"
        ) {
          break;
        }

        if (applet._uuid === "xapp-status@cinnamon.org") {
          const icons = applet.statusIcons as Record<string, any>;
          for (const icon of Object.values(icons)) {
            const { name, icon_name } = icon.proxy as StatusIconInterfaceProxy;
            const key = applet._uuid + name + icon_name;
            if (this.icons[key] && this.icons[key].show) {
              continue;
            }

            icon.actor.hide();
          }
        }

        const { uuid, name, icon } = applet._meta;
        const key = uuid + name + icon;
        if (this.icons[key] && this.icons[key].show) {
          continue;
        }

        child.hide();
      } else {
        // No need to check for what should be shown, since we just show everything here.
        if (this.alreadyHidden.indexOf(child) < 0) {
          child.show();
        }

        if (applet._uuid == "systray@cinnamon.org") {
          try {
            for (const j of child.get_first_child().get_children()) {
              j.show();
            }
          } catch (e) {
            global.logError(e);
          }
        }

        if (applet._uuid === "xapp-status@cinnamon.org") {
          const icons = applet.statusIcons as Record<string, any>;
          for (const icon of Object.values(icons)) {
            const { name, icon_name } = icon.proxy as StatusIconInterfaceProxy;
            if (name.trim() !== "" && icon_name.trim() !== "") {
              icon.actor.show();
            }
          }
        }
      }
    }

    if (!this.do_hide && this.do_autohide && !global.settings.get_boolean("panel-edit-mode")) {
      // @ts-expect-error timeout_add_seconds Type is wrong
      this._hideTimeoutId = Mainloop.timeout_add_seconds(
        this.hide_time,
        Lang.bind(this, function (this: MyApplet) {
          this.auto_hide();
        }),
      );
    }

    this.update_autohide_tooltip();

    global.log("Toggling hiding: " + this.do_hide + " -> " + !this.do_hide);
    this.do_hide = !this.do_hide;
  }

  update_autohide_tooltip() {
    if (this.do_autohide) this.set_applet_tooltip(_("Autohide ON"));
    else this.set_applet_tooltip(_("Autohide OFF"));
  }

  update_icons() {
    for (const childBoxLayout of this.get_eligible_children()) {
      const applet = childBoxLayout._applet as any;
      if (applet._uuid === "xapp-status@cinnamon.org") {
        // `applet` is a CinnamonXAppStatusApplet:
        // https://github.com/linuxmint/cinnamon/blob/master/files/usr/share/cinnamon/applets/xapp-status%40cinnamon.org/applet.js#L391C6-L391C32
        Object.values(applet.statusIcons as Record<string, any>).forEach((icon) => {
          // `icon` is a XAppStatusIcon, NOT imports.gi.XApp.StatusIcon
          // https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/files/usr/share/cinnamon/applets/xapp-status%40cinnamon.org/applet.js#L106
          // Object.keys(icon):
          // name, applet, proxy, iconName, actor, icon_holder, iconSize, label, _tooltip, _proxy_prop_change_id, show_label
          const { name, icon_name } = icon.proxy as StatusIconInterfaceProxy;

          // xapp-status@cinnamon.org only renders proxies that have a name AND icon_name! (But icon_name seems to be a space when it's "empty".)
          if (name.trim() === "" || icon_name.trim() === "") return;

          const key = applet._uuid + name + icon_name;
          this.icons[key] ??= {
            ownerUuid: applet._uuid,
            name,
            icon_name,
            last_seen: Date.now(),
            show: false,
          };
          this.icons[key].last_seen = Date.now();
        });
      } else if (applet._uuid === "systray@cinnamon.org") {
        // It's typeof St.Bin[], the buttons created here: https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/files/usr/share/cinnamon/applets/systray%40cinnamon.org/applet.js#L147
        for (const j of childBoxLayout.get_first_child().get_children() as any) {
          // CinnamonTrayIcon: https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/src/cinnamon-tray-icon.c#L20
          const icon = j.get_child();
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

    Mainloop.timeout_add_seconds(
      30,
      Lang.bind(this, function (this: MyApplet) {
        this.update_icons();
      }),
    );
  }

  update_our_icon() {
    if (this.do_hide) {
      if (this.is_vertical()) {
        this.set_applet_icon_symbolic_name("2v");
      }
      else {
        this.set_applet_icon_symbolic_name("2");
      }
    }
    else {
      if (this.is_vertical()) {
        this.set_applet_icon_symbolic_name("1v");
      }
      else {
        this.set_applet_icon_symbolic_name("1");
      }
    }
  }

  update_popup_menu() {
    if (!this._applet_context_menu.isOpen) {
      if (!this.menu_items_icon_section) {
        this.menu_items_icon_section = new PopupMenu.PopupMenuSection();

        this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 0);
        this._applet_context_menu.addMenuItem(this.menu_items_icon_section, 0);
        this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 0);

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
        this.menu_item_auto_hide.connect(
          "toggled",
          Lang.bind(this, function (this: MyApplet) {
            this.do_autohide = !this.do_autohide;
          }),
        );
        this._applet_context_menu.addMenuItem(this.menu_item_auto_hide, 0);
      }

      this.menu_items_icon_section.removeAll();
      Object.entries(this.icons).forEach(([key, { name, show, icon_name }]) => {
        // PopupSwitchIconMenuItem can't render images from paths
        const iconToggle =
          icon_name && !icon_name.includes("/")
            ? new PopupMenu.PopupSwitchIconMenuItem(name, show, icon_name, St.IconType.SYMBOLIC)
            : new PopupMenu.PopupSwitchMenuItem(name, show);
        // @ts-expect-error
        iconToggle.connect(
          "toggled",
          Lang.bind(this, function (this: MyApplet) {
            this.icons[key].show = !this.icons[key].show;
          }),
        );
        this.menu_items_icon_section!.addMenuItem(iconToggle);
      });
    }

    Mainloop.timeout_add_seconds(
      30,
      Lang.bind(this, function (this: MyApplet) {
        this.update_popup_menu();
      }),
    );
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
