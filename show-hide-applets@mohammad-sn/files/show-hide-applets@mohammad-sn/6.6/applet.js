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
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/applet.ts
var applet_exports = {};
__export(applet_exports, {
  main: () => main,
});
module.exports = __toCommonJS(applet_exports);
var {
  gettext,
  gi: {
    Gtk,
    St,
    GLib,
    Gio,
    GdkPixbuf: { Pixbuf },
  },
  ui: {
    applet: { IconApplet },
    popupMenu: {
      PopupMenuSection,
      PopupSeparatorMenuItem,
      PopupMenuItem,
      PopupSwitchMenuItem,
      PopupSwitchIconMenuItem,
    },
    settings: { AppletSettings },
  },
} = imports;
var UUID = "show-hide-applets@mohammad-sn";
gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
var ICON_SWITCH_STORE_DURATION = 7 * 24 * 60 * 60 * 1e3;
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
var MyApplet = class extends IconApplet {
  settings;
  orientation;
  // Settings-bound properties
  do_autohide;
  hover_activates;
  hover_activates_hide;
  hide_time;
  hover_time;
  autohideReshowing;
  hide_until_separator;
  // Runtime state
  do_hide;
  already_hidden;
  last_toggle_hiding_end;
  last_toggle_hiding_start;
  loaded_panel;
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
  hide_timeout_id = null;
  reshowing_hide_timeout_id = null;
  update_icons_timeout_id = null;
  update_popup_menu_timeout_id = null;
  constructor(metadata, orientation, panel_height, instance_id) {
    super(orientation, panel_height, instance_id);
    this.orientation = orientation;
    this.hide_timeout_id = null;
    this.reshowing_hide_timeout_id = null;
    this.update_icons_timeout_id = null;
    this.last_toggle_hiding_start = 0;
    this.last_toggle_hiding_end = 0;
    this.do_hide = true;
    this.already_hidden = [];
    try {
      this.bind_settings();
      Gtk.IconTheme.get_default().append_search_path(metadata.path);
      this.icons_dir = Gio.File.new_for_path(metadata.path + "/icons");
      global.log(`icons_dir: ${this.icons_dir.get_path()}`);
      if (!this.icons_dir.query_exists(null)) {
        this.icons_dir.make_directory_with_parents(null);
      }
      Gtk.IconTheme.get_default().append_search_path(this.icons_dir.get_path());
      this.loaded_panel = this.panel;
      this.update_our_icon();
      this.update_autohide_tooltip();
      this.connected_on_panel_edit_mode_changed = global.settings.connect(
        "changed::panel-edit-mode",
        () => this.on_panel_edit_mode_changed(),
      );
      this.connected_on_entered = this.actor.connect(
        // "enter-event" works but I can't find it in the cinnamon repo: https://github.com/search?q=repo%3Alinuxmint%2Fcinnamon%20enter-event&type=code
        // @ts-expect-error types are wrong
        "enter-event",
        () => this.on_entered(),
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
        },
      );
      if (this.do_autohide) {
        this.hide_timeout_id = timeout_add_seconds_once(this.hide_time, () => {
          this.hide_timeout_id = null;
          this.auto_hide();
        });
      }
    } catch (error) {
      global.logError(error);
    }
  }
  auto_hide() {
    if (this.hide_timeout_id || !this.do_autohide) {
      return;
    }
    let postpone = this.actor.hover && this.hover_activates;
    const children = this.get_zone_children();
    const p = children.indexOf(this.actor);
    for (let i = 0; i < p; i++) {
      postpone ||= children[i].hover;
      if (children[i]._applet._menuManager) {
        postpone ||= children[i]._applet._menuManager._activeMenu;
      }
      if (children[i]._applet.menuManager) {
        postpone ||= children[i]._applet.menuManager._activeMenu;
      }
      if (postpone) {
        break;
      }
    }
    if (postpone) {
      this.hide_timeout_id = timeout_add_seconds_once(this.hide_time, () => {
        this.hide_timeout_id = null;
        this.auto_hide();
      });
    } else if (
      this.do_hide &&
      !global.settings.get_boolean("panel-edit-mode")
    ) {
      this.toggle_hiding();
    }
  }
  bind_settings() {
    try {
      this.settings = new AppletSettings(
        this,
        "devtest-show-hide-applets@mohammad-sn",
        this.instance_id,
      );
      this.settings.bind("autohiders", "autohideReshowing", () => {
        this.refresh_if_hidden();
      });
      this.settings.bind("do_autohide", "do_autohide", () => {
        if (this.hide_timeout_id && !this.do_autohide) {
          GLib.source_remove(this.hide_timeout_id);
          this.hide_timeout_id = null;
        } else if (this.do_autohide && this.do_hide) {
          this.auto_hide();
        }
        if (this.menu_item_auto_hide) {
          this.menu_item_auto_hide["_switch"].setToggleState(this.do_autohide);
        }
        this.update_autohide_tooltip();
      });
      this.settings.bind("hoveractivates", "hover_activates");
      this.settings.bind("hoveractivateshide", "hover_activates_hide");
      this.settings.bind("hidetime", "hide_time");
      this.settings.bind("hovertime", "hover_time");
      this.settings.bind("hideuntilseparator", "hide_until_separator");
      this.icons = this.settings.getValue("icons");
    } catch (error) {
      global.logError(error);
    }
  }
  ensure_local_icon(icon_name) {
    if (!icon_name.includes("/")) {
      return icon_name;
    }
    try {
      const is_ico = icon_name.endsWith(".ico");
      const dest_name = is_ico
        ? icon_name.replaceAll("/", "@").replace(".ico", ".png")
        : icon_name.replaceAll("/", "@");
      const dest_file = this.icons_dir.get_child(dest_name);
      if (!dest_file.query_exists(null)) {
        const source_file = Gio.File.new_for_path(icon_name);
        if (!source_file.query_exists(null)) {
          return void 0;
        }
        if (is_ico) {
          const pixbuf = Pixbuf.new_from_file(icon_name);
          pixbuf.savev(
            dest_file.get_path().replace(/\.ico$/u, ".png"),
            "png",
            null,
            null,
          );
        } else {
          source_file.copy(dest_file, Gio.FileCopyFlags.NONE, null, null);
        }
      }
      return dest_name.replace(/\.[^.]+$/u, "");
    } catch (error) {
      global.logError(error);
      return void 0;
    }
  }
  get_eligible_children() {
    const children = this.get_zone_children();
    const ourIndex = children.indexOf(this.actor);
    const eligible = [];
    if (this.do_hide) {
      for (let i = ourIndex - 1; i > -1; i--) {
        if (
          this.hide_until_separator &&
          children[i]._applet._uuid === "separator@cinnamon.org"
        ) {
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
    if (this.locationLabel === "right") {
      return this.loaded_panel["_rightBox"];
    } else if (this.locationLabel === "left") {
      return this.loaded_panel["_leftBox"];
    }
    return this.loaded_panel["_centerBox"];
  }
  // logs say these children are `StBoxLayout` but `StBoxLayout` type has `no _applet`, even though it exists...
  // So we return `any`, even though it should be `StBoxLayout`.
  get_zone_children() {
    try {
      return this.get_our_panel_zone().get_children();
    } catch (error) {
      global.logError(error);
      return [];
    }
  }
  is_vertical() {
    return (
      this.orientation === St.Side.LEFT || this.orientation === St.Side.RIGHT
    );
  }
  // This is mostly about the xapps icon tray regularly "showing" its icons.
  on_allocation_changed() {
    global.log("on_allocation_changed");
    const now = GLib.get_monotonic_time();
    if (
      // 50ms
      now - this.last_toggle_hiding_end < 5e4 ||
      now - this.last_toggle_hiding_start < 5e4
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
    if (this.connected_on_panel_edit_mode_changed) {
      global.settings.disconnect(this.connected_on_panel_edit_mode_changed);
    }
    if (this.connected_on_entered) {
      this.actor.disconnect(this.connected_on_entered);
    }
    if (this.connected_on_allocation_changed) {
      this.get_our_panel_zone().disconnect(
        this.connected_on_allocation_changed,
      );
    }
    for (const id of [
      this.update_icons_timeout_id,
      this.update_popup_menu_timeout_id,
      this.reshowing_hide_timeout_id,
      this.hide_timeout_id,
    ]) {
      if (id) {
        GLib.source_remove(id);
      }
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
    this.menu_item_panel_edit_mode.setToggleState(
      global.settings.get_boolean("panel-edit-mode"),
    );
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
  refresh_if_hidden() {
    if (!this.do_hide) {
      this.do_hide = true;
      this.toggle_hiding(true);
    }
  }
  reset_icons() {
    this._applet_context_menu.close(false);
    const iconsBackup = JSON.parse(JSON.stringify(this.icons));
    this.icons = {};
    this.update_icons();
    Object.entries(iconsBackup).forEach(([key, { show }]) => {
      if (this.icons[key]) {
        this.icons[key].show = show;
      }
    });
    this.update_popup_menu();
    timeout_add_once(10, () => {
      this._applet_context_menu.open(false);
    });
  }
  start_periodic_updaters() {
    this.update_icons_timeout_id = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      30,
      () => {
        this.update_icons();
        return GLib.SOURCE_CONTINUE;
      },
    );
    this.update_popup_menu_timeout_id = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      30,
      () => {
        this.update_popup_menu();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }
  toggle_hiding(refreshing = false) {
    try {
      if (this.hide_timeout_id) {
        GLib.source_remove(this.hide_timeout_id);
        this.hide_timeout_id = null;
      }
      this.last_toggle_hiding_start = GLib.get_monotonic_time();
      this.update_our_icon();
      if (this.do_hide && !refreshing) {
        this.already_hidden = [];
      }
      for (const child of this.get_eligible_children()) {
        const applet = child._applet;
        if (this.do_hide) {
          if (
            this.hide_until_separator &&
            applet._uuid === "separator@cinnamon.org"
          ) {
            break;
          }
          if (applet._uuid === "systray@cinnamon.org") {
            for (const systray_child of child
              .get_first_child()
              .get_children()) {
              const icon2 = systray_child.get_child();
              if (!systray_child.visible && !refreshing) {
                this.already_hidden.push(systray_child);
              }
              const key2 = applet._uuid + icon2.title;
              if (this.icons[key2]?.show) {
                continue;
              }
              systray_child.hide();
            }
            continue;
          }
          if (applet._uuid === "xapp-status@cinnamon.org") {
            for (const xapp_child of Object.values(applet.statusIcons)) {
              const { name: name2, icon_name, visible } = xapp_child.proxy;
              if (!visible && !refreshing) {
                this.already_hidden.push(xapp_child);
              }
              const key2 = applet._uuid + name2 + icon_name;
              if (this.icons[key2]?.show) {
                continue;
              }
              xapp_child.actor.hide();
            }
            continue;
          }
          if (!child.visible && !refreshing) {
            this.already_hidden.push(child);
          }
          const { uuid, name, icon } = applet._meta;
          const key = uuid + name + icon;
          if (this.icons[key]?.show) {
            continue;
          }
          child.hide();
        } else {
          if (!this.already_hidden.includes(child)) {
            child.show();
          }
          if (applet._uuid === "systray@cinnamon.org") {
            try {
              for (const systray_child of child
                .get_first_child()
                .get_children()) {
                if (!this.already_hidden.includes(systray_child)) {
                  systray_child.show();
                }
              }
            } catch (error) {
              global.logError(error);
            }
          }
          if (applet._uuid === "xapp-status@cinnamon.org") {
            for (const xapp_child of Object.values(applet.statusIcons)) {
              const { name, icon_name } = xapp_child.proxy;
              if (
                name.trim() !== "" &&
                icon_name.trim() !== "" &&
                !this.already_hidden.includes(xapp_child)
              ) {
                xapp_child.actor.show();
              }
            }
          }
        }
      }
      if (
        !this.do_hide &&
        this.do_autohide &&
        !global.settings.get_boolean("panel-edit-mode")
      ) {
        this.hide_timeout_id = timeout_add_seconds_once(this.hide_time, () => {
          this.hide_timeout_id = null;
          this.auto_hide();
        });
      }
      global.log("Toggling hiding: " + this.do_hide + " -> " + !this.do_hide);
      this.do_hide = !this.do_hide;
      this.last_toggle_hiding_end = GLib.get_monotonic_time();
    } catch (error) {
      global.logError(error);
    }
  }
  update_autohide_tooltip() {
    if (this.do_autohide) {
      this.set_applet_tooltip(_("Autohide ON"));
    } else {
      this.set_applet_tooltip(_("Autohide OFF"));
    }
  }
  update_icons() {
    for (const child_box_layout of this.get_eligible_children()) {
      const applet = child_box_layout._applet;
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
            icon_name: icon_name ? this.ensure_local_icon(icon_name) : void 0,
            last_seen: Date.now(),
            show: false,
          };
          this.icons[key].last_seen = Date.now();
        });
      } else if (applet._uuid === "systray@cinnamon.org") {
        for (const systrayIcon of child_box_layout
          .get_first_child()
          .get_children()) {
          const icon = systrayIcon.get_child();
          const key = applet._uuid + icon.title;
          this.icons[key] ??= {
            ownerUuid: applet._uuid,
            name: icon.title,
            last_seen: Date.now(),
            show: false,
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
    const iconValues = Object.values(this.icons);
    if (
      iconValues[0]?.ownerUuid === "xapp-status@cinnamon.org" &&
      iconValues.at(-1)?.ownerUuid !== "xapp-status@cinnamon.org"
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
        this.menu_items_icon_section = new PopupMenuSection();
        this._applet_context_menu.addMenuItem(new PopupSeparatorMenuItem(), 0);
        this._applet_context_menu.addMenuItem(this.menu_items_icon_section, 0);
        this._applet_context_menu.addMenuItem(new PopupSeparatorMenuItem(), 0);
        const menu_item_reset_icons_list = new PopupMenuItem(
          _("Reset icons list"),
        );
        menu_item_reset_icons_list.connect("activate", () => {
          this.reset_icons();
        });
        this._applet_context_menu.addMenuItem(menu_item_reset_icons_list, 0);
        this.menu_item_panel_edit_mode = new PopupSwitchMenuItem(
          _("Panel Edit mode"),
          global.settings.get_boolean("panel-edit-mode"),
        );
        this.menu_item_panel_edit_mode.connect("toggled", (item) => {
          global.settings.set_boolean("panel-edit-mode", item.state);
        });
        this._applet_context_menu.addMenuItem(
          this.menu_item_panel_edit_mode,
          0,
        );
        this.menu_item_auto_hide = new PopupSwitchMenuItem(
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
      Object.values(this.icons).forEach((icon) => {
        const { name, show, icon_name } = icon;
        const iconToggle = icon_name
          ? new PopupSwitchIconMenuItem(
              name,
              show,
              icon_name,
              icon_name.includes("/")
                ? St.IconType.FULLCOLOR
                : St.IconType.SYMBOLIC,
            )
          : new PopupSwitchMenuItem(name, show);
        iconToggle.connect("toggled", () => {
          icon.show = !icon.show;
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
  return new MyApplet(metadata, orientation, panel_height, instance_id);
}
