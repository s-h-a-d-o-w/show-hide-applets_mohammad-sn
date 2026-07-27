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
var Pixbuf = imports.gi.GdkPixbuf.Pixbuf;
var Settings = imports.ui.settings;
var PopupMenu = imports.ui.popupMenu;
var St = imports.gi.St;
var GLib = imports.gi.GLib;
var gettext = imports.gettext;
var Gio = imports.gi.Gio;
var UUID = "show-hide-applets@mohammad-sn";
gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
var ICON_SWITCH_STORE_DURATION = 5 * 60 * 1e3;
function _(str) {
  return gettext.dgettext(UUID, str);
}
function timeout_add_once(interval, callback) {
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
    callback();
    return GLib.SOURCE_REMOVE;
  });
}
function timeout_add_seconds_once(interval, callback) {
  return GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
    callback();
    return GLib.SOURCE_REMOVE;
  });
}
var MyApplet = class extends Applet.IconApplet {
  settings;
  orientation;
  applet_path;
  // Settings-bound properties
  do_autohide;
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
  last_toggle_hiding_end;
  last_toggle_hiding_start;
  loadedPanel;
  monitor;
  signal_manager;
  icons_dir;
  icons = {};
  // Menu items
  menu_item_auto_hide;
  menu_item_panel_edit_mode;
  menu_items_icon_section;
  // Connected signals
  connected_on_panel_edit_mode_changed;
  connected_on_entered;
  connected_on_allocation_changed;
  // Timeout IDs
  _hideTimeoutId = null;
  _reshowingHideTimeoutId = null;
  _updateIconsTimeoutId = null;
  _updatePopupMenuTimeoutId = null;
  constructor(metadata, orientation, panel_height, instance_id) {
    super(orientation, panel_height, instance_id);
    this.orientation = orientation;
    this.applet_path = metadata.path;
    this._hideTimeoutId = null;
    this._reshowingHideTimeoutId = null;
    this._updateIconsTimeoutId = null;
    this.last_toggle_hiding_start = 0;
    this.last_toggle_hiding_end = 0;
    try {
      this.settings = new Settings.AppletSettings(
        this,
        "devtest-show-hide-applets@mohammad-sn",
        this.instance_id
      );
      this.icons = this.settings.getValue("icons");
      global.log("icons: " + JSON.stringify(this.icons));
      Gtk.IconTheme.get_default().append_search_path(this.applet_path);
      this.icons_dir = Gio.File.new_for_path(this.applet_path + "/icons");
      if (!this.icons_dir.query_exists(null)) {
        this.icons_dir.make_directory_with_parents(null);
      }
      Gtk.IconTheme.get_default().append_search_path(this.icons_dir.get_path());
      this.loadedPanel = this.panel;
      this.update_our_icon();
      this.bind_settings();
      this.update_autohide_tooltip();
      this.connected_on_panel_edit_mode_changed = global.settings.connect(
        "changed::panel-edit-mode",
        Lang.bind(this, this.on_panel_edit_mode_changed)
      );
      this.connected_on_entered = this.actor.connect(
        // "enter-event" works but I can't find it in the cinnamon repo: https://github.com/search?q=repo%3Alinuxmint%2Fcinnamon%20enter-event&type=code
        // @ts-expect-error
        "enter-event",
        Lang.bind(this, this.on_entered)
      );
      timeout_add_seconds_once(1, () => {
        this.update_icons();
        this.update_popup_menu();
        this.start_periodic_updaters();
      });
      this.connected_on_allocation_changed = this.get_our_panel_zone().connect(
        "allocation-changed",
        () => {
          this.on_allocation_changed();
        }
      );
      this.do_hide = true;
      this.alreadyHidden = [];
      timeout_add_once(10, () => {
        this.toggle_hiding();
      });
    } catch (e) {
      global.logError(e);
    }
  }
  auto_hide() {
    if (this._hideTimeoutId || !this.do_autohide) {
      return;
    }
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
    this.settings.bindProperty(
      Settings.BindingDirection.BIDIRECTIONAL,
      "do_autohide",
      "do_autohide",
      () => {
        if (this._hideTimeoutId && !this.do_autohide) {
          GLib.source_remove(this._hideTimeoutId);
          this._hideTimeoutId = null;
        } else if (this.do_autohide && this.do_hide) this.auto_hide();
        if (this.menu_item_auto_hide) {
          this.menu_item_auto_hide["_switch"].setToggleState(this.do_autohide);
        }
        this.update_autohide_tooltip();
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
      () => {
        if (!this.do_hide) {
          this.toggle_hiding();
          this.auto_hide();
        }
      },
      null
    );
    this.settings.bindProperty(
      Settings.BindingDirection.IN,
      "hideuntilseparator",
      "hide_until_separator",
      () => {
      },
      null
    );
  }
  ensure_local_icon(icon_name) {
    if (!icon_name.includes("/")) {
      return icon_name;
    }
    const is_ico = icon_name.endsWith(".ico");
    const dest_name = is_ico ? icon_name.replace(/\//g, "@").replace(/\.ico$/, ".png") : icon_name.replace(/\//g, "@");
    const dest_file = this.icons_dir.get_child(dest_name);
    if (!dest_file.query_exists(null)) {
      const source_file = Gio.File.new_for_path(icon_name);
      if (!source_file.query_exists(null)) {
        return void 0;
      }
      if (is_ico) {
        const pixbuf = Pixbuf.new_from_file(icon_name);
        pixbuf.savev(dest_file.get_path().replace(/\.ico$/, ".png"), "png", null, null);
      } else {
        source_file.copy(dest_file, Gio.FileCopyFlags.NONE, null, null);
      }
    }
    return dest_name.replace(/\.[^.]+$/, "");
  }
  get_eligible_children() {
    let children = this.get_zone_children();
    let ourIndex = children.indexOf(this.actor);
    let eligible = [];
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
    return this.get_our_panel_zone().get_children();
  }
  is_vertical() {
    return this.orientation == St.Side.LEFT || this.orientation == St.Side.RIGHT;
  }
  // This is mostly about the xapps icon tray regularly "showing" its icons.
  on_allocation_changed() {
    global.log("on_allocation_changed");
    const now = GLib.get_monotonic_time();
    if (
      // 50ms
      now - this.last_toggle_hiding_end < 5e4 || now - this.last_toggle_hiding_start < 5e4
    ) {
      return;
    }
    if (this.autohideReshowing && !this.do_hide) {
      this.do_hide = true;
      this.toggle_hiding(true);
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
    if (this.connected_on_panel_edit_mode_changed) {
      global.settings.disconnect(this.connected_on_panel_edit_mode_changed);
    }
    if (this.connected_on_entered) {
      this.actor.disconnect(this.connected_on_entered);
    }
    if (this.connected_on_allocation_changed) {
      this.get_our_panel_zone().disconnect(this.connected_on_allocation_changed);
    }
    for (const id of [
      this._updateIconsTimeoutId,
      this._updatePopupMenuTimeoutId,
      this._reshowingHideTimeoutId,
      this._hideTimeoutId
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
    if (!this.actor.hover && this.hover_activates && !global.settings.get_boolean("panel-edit-mode")) {
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
  on_orientation_changed(orientation) {
    this.orientation = orientation;
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
  toggle_hiding(refreshing = false) {
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
          if (!child.visible && !refreshing) {
            this.alreadyHidden.push(child);
          }
          if (applet._uuid == "systray@cinnamon.org") {
            for (const j of child.get_first_child().get_children()) {
              const icon2 = j.get_child();
              const key2 = applet._uuid + icon2.title;
              if (this.icons[key2] && this.icons[key2].show) {
                continue;
              }
              j.hide();
            }
            continue;
          } else if (this.hide_until_separator && applet._uuid == "separator@cinnamon.org") {
            break;
          }
          if (applet._uuid === "xapp-status@cinnamon.org") {
            const icons = applet.statusIcons;
            for (const icon2 of Object.values(icons)) {
              const { name: name2, icon_name } = icon2.proxy;
              const key2 = applet._uuid + name2 + icon_name;
              if (this.icons[key2] && this.icons[key2].show) {
                continue;
              }
              icon2.actor.hide();
            }
            continue;
          }
          const { uuid, name, icon } = applet._meta;
          const key = uuid + name + icon;
          if (this.icons[key] && this.icons[key].show) {
            continue;
          }
          child.hide();
        } else {
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
            const icons = applet.statusIcons;
            for (const icon of Object.values(icons)) {
              const { name, icon_name } = icon.proxy;
              if (name.trim() !== "" && icon_name.trim() !== "") {
                icon.actor.show();
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
      const applet = childBoxLayout._applet;
      if (applet._uuid === "separator@cinnamon.org") {
        continue;
      } else if (applet._uuid === "xapp-status@cinnamon.org") {
        Object.values(applet.statusIcons).forEach((icon) => {
          const { name, icon_name } = icon.proxy;
          if (name.trim() === "" || icon_name.trim() === "") {
            return;
          }
          const key = applet._uuid + name + icon_name;
          this.icons[key] ??= {
            ownerUuid: applet._uuid,
            name,
            icon_name,
            last_seen: Date.now(),
            show: false
          };
          this.icons[key].last_seen = Date.now();
        });
      } else if (applet._uuid === "systray@cinnamon.org") {
        for (const systrayIcon of childBoxLayout.get_first_child().get_children()) {
          const icon = systrayIcon.get_child();
          const key = applet._uuid + icon.title;
          this.icons[key] ??= {
            ownerUuid: applet._uuid,
            name: icon.title,
            last_seen: Date.now(),
            show: false
          };
          this.icons[key].last_seen = Date.now();
        }
      } else {
        const { uuid, name, icon } = applet._meta;
        const key = uuid + name + icon;
        this.icons[key] ??= {
          ownerUuid: uuid,
          name,
          icon_name: icon,
          last_seen: Date.now(),
          show: false
        };
        this.icons[key].last_seen = Date.now();
      }
    }
    Object.entries(this.icons).forEach(([key, icon]) => {
      if (Date.now() - icon.last_seen > ICON_SWITCH_STORE_DURATION) {
        delete this.icons[key];
      }
    });
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
        this.menu_item_panel_edit_mode = new PopupMenu.PopupSwitchMenuItem(
          _("Panel Edit mode"),
          global.settings.get_boolean("panel-edit-mode")
        );
        this.menu_item_panel_edit_mode.connect("toggled", function(item) {
          global.settings.set_boolean("panel-edit-mode", item.state);
        });
        this._applet_context_menu.addMenuItem(this.menu_item_panel_edit_mode, 0);
        this.menu_item_auto_hide = new PopupMenu.PopupSwitchMenuItem(
          _("Autohide"),
          this.do_autohide
        );
        this.menu_item_auto_hide.connect("toggled", () => {
          this.do_autohide = !this.do_autohide;
          this.update_autohide_tooltip();
        });
        this._applet_context_menu.addMenuItem(this.menu_item_auto_hide, 0);
      }
      this.menu_items_icon_section.removeAll();
      Object.entries(this.icons).forEach(([key, { name, show, icon_name }]) => {
        const resolved_icon_name = icon_name ? this.ensure_local_icon(icon_name) : void 0;
        const iconToggle = resolved_icon_name ? new PopupMenu.PopupSwitchIconMenuItem(
          name,
          show,
          resolved_icon_name,
          icon_name.includes("/") ? St.IconType.FULLCOLOR : St.IconType.SYMBOLIC
        ) : new PopupMenu.PopupSwitchMenuItem(name, show);
        iconToggle.connect("toggled", () => {
          this.icons[key].show = !this.icons[key].show;
          this.settings.setValue("icons", this.icons);
          if (!this.do_hide) {
            this.toggle_hiding();
            this.toggle_hiding();
          }
        });
        this.menu_items_icon_section.addMenuItem(iconToggle);
      });
    }
  }
};
function main(metadata, orientation, panel_height, instance_id) {
  let myApplet = new MyApplet(metadata, orientation, panel_height, instance_id);
  return myApplet;
}
