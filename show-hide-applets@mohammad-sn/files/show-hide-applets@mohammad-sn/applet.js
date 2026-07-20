"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/applet.ts
var applet_exports = {};
__export(applet_exports, {
  main: () => main
});
module.exports = __toCommonJS(applet_exports);
var Applet = imports.ui.applet;
var Lang = imports.lang;
var Gtk = imports.gi.Gtk;
var Settings = imports.ui.settings;
var PopupMenu = imports.ui.popupMenu;
var Mainloop = imports.mainloop;
var Util = imports.misc.util;
var St = imports.gi.St;
var GLib = imports.gi.GLib;
var gettext = imports.gettext;
var XApp = imports.gi.XApp;
var Main = imports.ui.main;
var Gio = imports.gi.Gio;
var UUID = "show-hide-applets@mohammad-sn";
gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
function _(str) {
  return gettext.dgettext(UUID, str);
}
var MyApplet = class extends Applet.IconApplet {
  settings;
  orientation;
  _hideTimeoutId;
  _reshowingHideTimeoutId;
  _showTimeoutId;
  // Settings-bound properties
  do_autohide;
  statusintooltip;
  disable_starttime_autohide;
  hover_activates;
  hover_activates_hide;
  hide_time;
  hover_time;
  autohideReshowing;
  autohideReshowingTime;
  hide_until_separator;
  // Runtime state
  do_hide;
  alreadyHidden;
  loadedPanel;
  monitor;
  signal_manager;
  icons = [];
  // Menu items
  itemAutohide;
  panelEditMode;
  constructor(metadata, orientation, panel_height, instance_id) {
    super(orientation, panel_height, instance_id);
    this.orientation = orientation;
    this._hideTimeoutId = null;
    this._reshowingHideTimeoutId = null;
    try {
      Gtk.IconTheme.get_default().append_search_path(metadata.path);
      if (this.is_vertical()) this.set_applet_icon_symbolic_name("1v");
      else this.set_applet_icon_symbolic_name("1");
      this.loadedPanel = this.panel;
      this.update_icons();
      this.bind_settings();
      this.create_popup_menu();
      global.settings.connect(
        "changed::panel-edit-mode",
        Lang.bind(this, this.on_panel_edit_mode_changed)
      );
      this.actor.connect("enter-event", Lang.bind(this, this._onEntered));
      this.do_hide = true;
      this.alreadyHidden = [];
      if (!this.disable_starttime_autohide || this.do_autohide) {
        this._hideTimeoutId = Mainloop.timeout_add_seconds(
          2,
          Lang.bind(this, function() {
            if (this.do_hide) this.auto_hide(true);
          })
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
          Lang.bind(this, function() {
            if (this.autohideReshowing && !this.do_hide) {
              this._reshowingHideTimeoutId = Mainloop.timeout_add_seconds(
                this.autohideReshowingTime,
                Lang.bind(this, function() {
                  if (!this.do_hide) {
                    this.toggle_hiding(true);
                    this.auto_hide(true);
                  }
                  return false;
                })
              );
            }
          })
        )
      );
    } catch (e) {
      global.logError(e);
    }
  }
  bind_settings() {
    this.settings = new Settings.AppletSettings(
      this,
      "devtest-show-hide-applets@mohammad-sn",
      this.instance_id
    );
    this.settings.bindProperty(
      Settings.BindingDirection.BIDIRECTIONAL,
      "do_autohide",
      "do_autohide",
      Lang.bind(this, function() {
        if (this._hideTimeoutId && !this.do_autohide) {
          Mainloop.source_remove(this._hideTimeoutId);
          this._hideTimeoutId = null;
        } else if (this.do_autohide && this.do_hide) this.auto_hide(true);
        if (this.itemAutohide) {
          this.itemAutohide["_switch"].setToggleState(this.do_autohide);
        }
      }),
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "statusintooltip",
      "statusintooltip",
      Lang.bind(this, function() {
        if (!this.statusintooltip) {
          this.set_applet_tooltip("");
        } else {
          if (this.do_autohide) this.set_applet_tooltip(_("Autohide ON"));
          else this.set_applet_tooltip(_("Autohide OFF"));
        }
      }),
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "disablestarttimeautohide",
      "disable_starttime_autohide",
      function() {
      },
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hoveractivates",
      "hover_activates",
      function() {
      },
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hoveractivateshide",
      "hover_activates_hide",
      function() {
      },
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hidetime",
      "hide_time",
      function() {
      },
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hovertime",
      "hover_time",
      function() {
      },
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "autohiders",
      "autohideReshowing",
      Lang.bind(this, function() {
        if (!this.do_hide) {
          this.toggle_hiding(true);
          this.auto_hide(true);
        }
      }),
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "autohiderstime",
      "autohideReshowingTime",
      function() {
      },
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hideuntilseparator",
      "hide_until_separator",
      function() {
      },
      null
    );
  }
  create_popup_menu() {
    let editMode = global.settings.get_boolean("panel-edit-mode");
    this.panelEditMode = new PopupMenu.PopupSwitchMenuItem(_("Panel Edit mode"), editMode);
    this.panelEditMode.connect("toggled", function(item) {
      global.settings.set_boolean("panel-edit-mode", item.state);
    });
    this._applet_context_menu.addMenuItem(this.panelEditMode);
    this.itemAutohide = new PopupMenu.PopupSwitchMenuItem(_("Autohide"), this.do_autohide);
    this.itemAutohide.connect(
      "toggled",
      Lang.bind(this, function() {
        this.do_autohide = !this.do_autohide;
      })
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
    return this.get_our_panel_zone().get_children();
  }
  update_icons() {
    this.icons = [];
    for (const childBoxLayout of this.get_zone_children()) {
      const applet = childBoxLayout._applet;
      if (applet._uuid === "xapp-status@cinnamon.org") {
        Object.values(applet.statusIcons).forEach((icon) => {
          const { name, icon_name } = icon.proxy;
          if (name && icon_name) {
            this.icons.push({
              ownerUuid: applet._uuid,
              name,
              icon_name,
              last_seen: Date.now()
            });
          }
        });
      } else if (applet._uuid === "systray@cinnamon.org") {
        for (const j of childBoxLayout.get_first_child().get_children()) {
          const icon = j.get_child();
          this.icons.push({
            ownerUuid: applet._uuid,
            name: icon.title,
            last_seen: Date.now()
          });
        }
      } else {
        this.icons.push({
          ownerUuid: applet._meta.uuid,
          name: applet._meta.name,
          icon_name: applet._meta.icon,
          last_seen: Date.now()
        });
      }
    }
    Mainloop.timeout_add_seconds(
      30,
      Lang.bind(this, function() {
        this.update_icons();
      })
    );
  }
  on_applet_clicked() {
    this.toggle_hiding(true);
    return true;
  }
  _onEntered() {
    if (!this.actor.hover && this.hover_activates && !global.settings.get_boolean("panel-edit-mode"))
      this._showTimeoutId = Mainloop.timeout_add(
        this.hover_time,
        Lang.bind(this, function() {
          if (this.actor.hover && (this.hover_activates_hide || !this.do_hide))
            this.toggle_hiding(true);
        })
      );
  }
  toggle_hiding(update_already_hidden) {
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
        } else if (this.hide_until_separator && applets[i]._applet._uuid == "separator@cinnamon.org") {
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
        this._hideTimeoutId = Mainloop.timeout_add_seconds(
          this.hide_time,
          Lang.bind(this, function() {
            this.auto_hide(update_already_hidden);
          })
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
  on_orientation_changed(orientation) {
    this.orientation = orientation;
  }
  auto_hide(update_already_hidden) {
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
      this._hideTimeoutId = Mainloop.timeout_add_seconds(
        this.hide_time,
        Lang.bind(this, function() {
          this.auto_hide(update_already_hidden);
        })
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
};
function main(metadata, orientation, panel_height, instance_id) {
  let myApplet = new MyApplet(metadata, orientation, panel_height, instance_id);
  return myApplet;
}
