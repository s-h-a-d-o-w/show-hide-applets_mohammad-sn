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
  _showTimeoutId!: number | null;

  // Settings-bound properties
  do_autohide!: boolean;
  statusintooltip!: boolean;
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
  icons: Array<{
    ownerUuid: string;
    name: string;
    last_seen: number;

    icon_name?: string;
  }> = [];

  // Menu items
  itemAutohide!: imports.ui.popupMenu.PopupSwitchMenuItem;
  panelEditMode!: imports.ui.popupMenu.PopupSwitchMenuItem;

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

      this.update_icons();
      this.bind_settings();
      this.create_popup_menu();

      global.settings.connect(
        "changed::panel-edit-mode",
        Lang.bind(this, this.on_panel_edit_mode_changed),
      );

      // "enter-event" works but I can't find it in the cinnamon repo: https://github.com/search?q=repo%3Alinuxmint%2Fcinnamon%20enter-event&type=code
      // @ts-expect-error
      this.actor.connect("enter-event", Lang.bind(this, this._onEntered));

      this.do_hide = true;
      this.alreadyHidden = [];
      if (!this.disable_starttime_autohide || this.do_autohide) {
        // @ts-expect-error timeout_add_seconds Type is wrong
        this._hideTimeoutId = Mainloop.timeout_add_seconds(
          2,
          Lang.bind(this, function (this: MyApplet) {
            if (this.do_hide) this.auto_hide(true);
          }),
        );
      }

      if (this._reshowingHideTimeoutId) {
        Mainloop.source_remove(this._reshowingHideTimeoutId);
        this._reshowingHideTimeoutId = null;
      }

      this.get_our_panel_zone().connect(
        "queue-relayout",
        Lang.bind(
          this,
          Lang.bind(this, function (this: MyApplet) {
            if (this.autohideReshowing && !this.do_hide) {
              // @ts-expect-error timeout_add_seconds Type is wrong
              this._reshowingHideTimeoutId = Mainloop.timeout_add_seconds(
                this.autohideReshowingTime,
                Lang.bind(this, function (this: MyApplet) {
                  if (!this.do_hide) {
                    this.toggle_hiding(true);
                    this.auto_hide(true);
                  }
                  return false;
                }),
              );
            }
          }),
        ),
      );
    } catch (e) {
      global.logError(e);
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
        } else if (this.do_autohide && this.do_hide) this.auto_hide(true);

        if (this.itemAutohide) {
          this.itemAutohide["_switch"].setToggleState(this.do_autohide);
        }
      }),
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "statusintooltip",
      "statusintooltip",
      Lang.bind(this, function (this: MyApplet) {
        if (!this.statusintooltip) {
          this.set_applet_tooltip("");
        } else {
          if (this.do_autohide) this.set_applet_tooltip(_("Autohide ON"));
          else this.set_applet_tooltip(_("Autohide OFF"));
        }
      }),
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "disablestarttimeautohide",
      "disable_starttime_autohide",
      function () {},
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hoveractivates",
      "hover_activates",
      function () {},
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hoveractivateshide",
      "hover_activates_hide",
      function () {},
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hidetime",
      "hide_time",
      function () {},
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hovertime",
      "hover_time",
      function () {},
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "autohiders",
      "autohideReshowing",
      Lang.bind(this, function (this: MyApplet) {
        if (!this.do_hide) {
          this.toggle_hiding(true);
          this.auto_hide(true);
        }
      }),
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "autohiderstime",
      "autohideReshowingTime",
      function (this: MyApplet) {},
      null,
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hideuntilseparator",
      "hide_until_separator",
      function (this: MyApplet) {},
      null,
    );
  }

  create_popup_menu() {
    let editMode = global.settings.get_boolean("panel-edit-mode");
    this.panelEditMode = new PopupMenu.PopupSwitchMenuItem(_("Panel Edit mode"), editMode);
    this.panelEditMode.connect("toggled", function (item) {
      global.settings.set_boolean("panel-edit-mode", item.state);
    });
    this._applet_context_menu.addMenuItem(this.panelEditMode);

    this.itemAutohide = new PopupMenu.PopupSwitchMenuItem(_("Autohide"), this.do_autohide);
    this.itemAutohide.connect(
      "toggled",
      Lang.bind(this, function (this: MyApplet) {
        this.do_autohide = !this.do_autohide;
      }),
    );
    this._applet_context_menu.addMenuItem(this.itemAutohide);
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

  update_icons() {
    this.icons = [];
    for (const childBoxLayout of this.get_zone_children()) {
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
          // xapp-status@cinnamon.org only renders proxies that have a name and iconName!
          if (name && icon_name) {
            this.icons.push({
              ownerUuid: applet._uuid,
              name,
              icon_name,
              last_seen: Date.now(),
            });
          }
        });
      } else if (applet._uuid === "systray@cinnamon.org") {
        // It's typeof St.Bin[], the buttons created here: https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/files/usr/share/cinnamon/applets/systray%40cinnamon.org/applet.js#L147
        for (const j of childBoxLayout.get_first_child().get_children() as any) {
          // CinnamonTrayIcon: https://github.com/linuxmint/cinnamon/blob/96cf2909241b1ce8a92577afcb66618e91b25d03/src/cinnamon-tray-icon.c#L20
          const icon = j.get_child();
          this.icons.push({
            ownerUuid: applet._uuid,
            name: icon.title,
            last_seen: Date.now(),
          });
        }
      } else {
        // `applet._meta` shape:
        // {"uuid":"network@cinnamon.org","name":"Network Manager","description":"Network manager applet","icon":"cs-network","state":1,"path":"/usr/share/cinnamon/applets/network@cinnamon.org","error":"","force_loaded":false}
        this.icons.push({
          ownerUuid: applet._meta.uuid,
          name: applet._meta.name,
          icon_name: applet._meta.icon,
          last_seen: Date.now(),
        });
      }
    }

    Mainloop.timeout_add_seconds(
      30,
      Lang.bind(this, function (this: MyApplet) {
        this.update_icons();
      }),
    );
  }

  on_applet_clicked() {
    this.toggle_hiding(true);
    return true;
  }

  _onEntered() {
    if (
      !this.actor.hover &&
      this.hover_activates &&
      !global.settings.get_boolean("panel-edit-mode")
    )
      this._showTimeoutId = Mainloop.timeout_add(
        this.hover_time,
        Lang.bind(this, function (this: MyApplet) {
          if (this.actor.hover && (this.hover_activates_hide || !this.do_hide))
            this.toggle_hiding(true);
        }),
      );
  }

  toggle_hiding(update_already_hidden: boolean) {
    if (this._hideTimeoutId) {
      Mainloop.source_remove(this._hideTimeoutId);
      this._hideTimeoutId = null;
    }

    let applets = this.get_zone_children();
    let ourIndex = applets.indexOf(this.actor);
    if (this.do_hide) {
      if (update_already_hidden) this.alreadyHidden = [];
      if (this.is_vertical()) this.set_applet_icon_symbolic_name("2v");
      else this.set_applet_icon_symbolic_name("2");
      for (let i = ourIndex - 1; i > -1; i--) {
        if (!applets[i].visible && update_already_hidden) this.alreadyHidden.push(applets[i]);
        if (applets[i]._applet._uuid == "systray@cinnamon.org") {
          const tray = applets[i];
          for (const j of tray.get_first_child().get_children()) {
            j.set_size(0, 0);
          }
          Mainloop.timeout_add(10, () => {
            tray.hide();
            return false;
          });
          continue;
        } else if (
          this.hide_until_separator &&
          applets[i]._applet._uuid == "separator@cinnamon.org"
        ) {
          break;
        }
        applets[i].hide();
      }
    } else {
      if (this.is_vertical()) this.set_applet_icon_symbolic_name("1v");
      else this.set_applet_icon_symbolic_name("1");
      for (let i = 0; i < ourIndex; i++) {
        if (this.alreadyHidden.indexOf(applets[i]) < 0) {
          applets[i].show();
        }

        if (applets[i]._applet._uuid == "systray@cinnamon.org") {
          for (const j of applets[i].get_first_child().get_children()) {
            j.set_size(20, 20);
          }
        }
      }

      if (this.do_autohide && !global.settings.get_boolean("panel-edit-mode"))
        // @ts-expect-error timeout_add_seconds Type is wrong
        this._hideTimeoutId = Mainloop.timeout_add_seconds(
          this.hide_time,
          Lang.bind(this, function (this: MyApplet) {
            this.auto_hide(update_already_hidden);
          }),
        );
    }
    if (this.statusintooltip) {
      if (this.do_autohide) this.set_applet_tooltip(_("Autohide ON"));
      else this.set_applet_tooltip(_("Autohide OFF"));
    }
    this.do_hide = !this.do_hide;
  }

  on_panel_edit_mode_changed() {
    this.panelEditMode.setToggleState(global.settings.get_boolean("panel-edit-mode"));
    if (global.settings.get_boolean("panel-edit-mode")) {
      if (!this.do_hide) {
        this.toggle_hiding(true);
      }
    } else if (this.do_hide) {
      this.toggle_hiding(true);
    }
  }

  on_orientation_changed(orientation: imports.gi.St.Side) {
    this.orientation = orientation;
  }

  auto_hide(update_already_hidden: boolean) {
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
    if (postpone)
      // @ts-expect-error timeout_add_seconds Type is wrong
      this._hideTimeoutId = Mainloop.timeout_add_seconds(
        this.hide_time,
        Lang.bind(this, function (this: MyApplet) {
          this.auto_hide(update_already_hidden);
        }),
      );
    else if (this.do_hide && !global.settings.get_boolean("panel-edit-mode"))
      this.toggle_hiding(update_already_hidden);
  }

  on_applet_removed_from_panel() {
    if (!this.do_hide) {
      this.toggle_hiding(true);
    }
  }

  on_applet_middle_clicked() {
    this.do_autohide = !this.do_autohide;
    if (this.itemAutohide) {
      this.itemAutohide["_switch"].setToggleState(this.do_autohide);
    }
    this.toggle_hiding(this.do_autohide);
    return true;
  }

  is_vertical() {
    return this.orientation == St.Side.LEFT || this.orientation == St.Side.RIGHT;
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
