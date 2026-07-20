const Applet = imports.ui.applet;
const Lang = imports.lang;
const Main = imports.ui.main;
const Gtk = imports.gi.Gtk;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gettext = imports.gettext;

const UUID = "show-hide-applets@mohammad-sn"
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale")

function _(str: string): string {
  return Gettext.dgettext(UUID, str);
}

class MyApplet extends Applet.IconApplet {
    settings!: imports.ui.settings.AppletSettings;
    orientation: imports.gi.St.Side;
    _hideTimeoutId: number | null;
    _reshowingHideTimeoutId: number | null;
    _showTimeoutId!: number | null;

    // Settings-bound properties
    auto_hide!: boolean;
    statusintooltip!: boolean;
    disable_starttime_autohide!: boolean;
    hover_activates!: boolean;
    hover_activates_hide!: boolean;
    hide_time!: number;
    hover_time!: number;
    autohideReshowing!: boolean;
    autohideReshowingTime!: number;
    hide_until_separator!: boolean;
    // locationLabel!: string;

    // Runtime state
    doHide!: boolean;
    alreadyHidden!: imports.gi.Clutter.Actor[];
    cbox!: imports.gi.St.BoxLayout;
    sta!: imports.gi.Clutter.Actor;
    stai!: number;
    loadedPanel!: imports.ui.panel.Panel;

    // Menu items
    itemAutohide!: imports.ui.popupMenu.PopupSwitchMenuItem;
    panelEditMode!: imports.ui.popupMenu.PopupSwitchMenuItem;
    

    constructor(metadata: any, orientation: imports.gi.St.Side, panel_height: number, instance_id: number) {
        super(orientation, panel_height, instance_id);

        this.orientation = orientation;
        this._hideTimeoutId = null;
        this._reshowingHideTimeoutId = null;

        try {
            Gtk.IconTheme.get_default().append_search_path(metadata.path);
            if (this.is_vertical())
                this.set_applet_icon_symbolic_name("1v");
            else
                this.set_applet_icon_symbolic_name("1");

            this.settings = new Settings.AppletSettings(this, "devtest-show-hide-applets@mohammad-sn", this.instance_id);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "autohide", "auto_hide", Lang.bind(this, function(this: MyApplet) {
                    if (this._hideTimeoutId && !this.auto_hide) {
                        Mainloop.source_remove(this._hideTimeoutId);
                        this._hideTimeoutId = null;
                    }
                    else if(this.auto_hide && this.doHide)
                        this.autoHide(true);

                    if (this.itemAutohide) {
                        this.itemAutohide._switch.setToggleState(this.auto_hide);
                    }
                }), null);

            this.settings.bindProperty(Settings.BindingDirection.IN, "statusintooltip", "statusintooltip", Lang.bind(this, function(this: MyApplet){
                    if (!this.statusintooltip) {
                        this.set_applet_tooltip("");
                    } else {
                        if (this.auto_hide)
                            this.set_applet_tooltip(_("Autohide ON"));
                        else
                            this.set_applet_tooltip(_("Autohide OFF"));
                    }
                }), null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "disablestarttimeautohide", "disable_starttime_autohide", function(){}, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "hoveractivates", "hover_activates", function(){}, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "hoveractivateshide", "hover_activates_hide", function(){}, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "hidetime", "hide_time", function(){}, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "hovertime", "hover_time", function(){}, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "autohiders", "autohideReshowing", Lang.bind(this,function (this: MyApplet) {
                    if(!this.doHide){
                        this.toggleHiding(true);
                        this.autoHide(true);
                    }
                }), null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "autohiderstime", "autohideReshowingTime", function(this: MyApplet) {}, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "hideuntilseparator", "hide_until_separator", function(this: MyApplet) {}, null);



            let editMode = global.settings.get_boolean("panel-edit-mode");
            this.panelEditMode = new PopupMenu.PopupSwitchMenuItem(_("Panel Edit mode"), editMode);
            this.panelEditMode.connect('toggled', function(item) {
                global.settings.set_boolean("panel-edit-mode", item.state);
            });
            this._applet_context_menu.addMenuItem(this.panelEditMode);

            let addapplets = new PopupMenu.PopupMenuItem(_("Add applets to the panel"));
            let addappletsicon = new St.Icon({icon_name: "applets", icon_size: 22, icon_type: St.IconType.FULLCOLOR });
            addapplets.connect('activate', Lang.bind(this, function(this: MyApplet) {
                Util.spawnCommandLine("cinnamon-settings applets panel"+this.loadedPanel.panelId);
            }));
            addapplets.addActor(addappletsicon, { align: St.Align.END });
            this._applet_context_menu.addMenuItem(addapplets);

            this.itemAutohide = new PopupMenu.PopupSwitchMenuItem(_("Autohide"),
              this.auto_hide);
            this.itemAutohide.connect("toggled", Lang.bind(this, function(this: MyApplet) {
              this.auto_hide = !this.auto_hide;
            }));

            this._applet_context_menu.addMenuItem(this.itemAutohide);

            global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed));
            this.actor.connect('enter-event', Lang.bind(this, this._onEntered));



            this.doHide = true;
            this.alreadyHidden = [];
            if((!this.disable_starttime_autohide) || this.auto_hide){
                this._hideTimeoutId = Mainloop.timeout_add_seconds(2, Lang.bind(this,function (this: MyApplet) {
                    if(this.doHide)
                        this.autoHide(true);
                }));
            }

            this.loadedPanel = this.panel!;
            if (this.locationLabel === "right")
                this.cbox = this.loadedPanel._rightBox;
            else if (this.locationLabel === "left")
                this.cbox = this.loadedPanel._leftBox;
            else
                this.cbox = this.loadedPanel._centerBox;

            if (this._reshowingHideTimeoutId){
                Mainloop.source_remove(this._reshowingHideTimeoutId);
                this._reshowingHideTimeoutId = null;
            }

            this.cbox.connect('queue-relayout', Lang.bind(this, Lang.bind(this, function(this: MyApplet){
                if (this.autohideReshowing && !this.doHide){
                    this._reshowingHideTimeoutId = Mainloop.timeout_add_seconds(this.autohideReshowingTime, Lang.bind(this,function (this: MyApplet) {
                        if(!this.doHide){
                            this.toggleHiding(true);
                            this.autoHide(true);
                        }
                        return false;
                    }));
                }
            })));
        }
        catch (e) {
            global.logError(e);
        }
    }

    on_applet_clicked() {
        this.toggleHiding(true);
        return true;
    }

    _onEntered() {
        if(!this.actor.hover && this.hover_activates && !global.settings.get_boolean("panel-edit-mode"))
            this._showTimeoutId = Mainloop.timeout_add(this.hover_time, Lang.bind(this,function (this: MyApplet) {
                if(this.actor.hover && (this.hover_activates_hide || !this.doHide))
                    this.toggleHiding(true);
            }));
    }

    toggleHiding(updateAlreadyHidden: boolean) {
        if (this._hideTimeoutId){
            Mainloop.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }
        
        let applets = (this.cbox as imports.gi.Clutter.Actor).get_children();
        let ourIndex = applets.indexOf(this.actor);
        if (this.doHide){
            if (updateAlreadyHidden)
                this.alreadyHidden=[];
            if (this.is_vertical())
                this.set_applet_icon_symbolic_name("2v");
            else
                this.set_applet_icon_symbolic_name("2");
            for(let i = ourIndex - 1; i > -1; i--){
                if(!applets[i].visible && updateAlreadyHidden)
                    this.alreadyHidden.push(applets[i]);
                if(applets[i]._applet._uuid=="systray@cinnamon.org" || applets[i]._applet._uuid=="systray@cinnaman"){
                    const tray = applets[i];
                    for(const j of tray.get_first_child().get_children()){
                        j.set_size(0, 0);
                    }
                    // TODO: can this be an unbound function?
                    Mainloop.timeout_add(10, Lang.bind(this, function(this: MyApplet) {
                        tray.hide();
                        return false;
                    }));
                    continue;
                }
                else if (this.hide_until_separator && applets[i]._applet._uuid=="separator@cinnamon.org") {
                    break;
                }
                applets[i].hide();
            }
        }
        else {
            if (this.is_vertical())
                this.set_applet_icon_symbolic_name("1v");
            else
                this.set_applet_icon_symbolic_name("1");
            for(let i = 0; i < ourIndex; i++){
                if(this.alreadyHidden.indexOf(applets[i])<0)
                    applets[i].show();
                if(applets[i]._applet._uuid=="systray@cinnaman"){
                    for(const j of applets[i].get_first_child().get_children()){
                        j.set_size(16, 16);
                    }
                }
                if(applets[i]._applet._uuid=="systray@cinnamon.org"){
                    for(const j of applets[i].get_first_child().get_children()){
                        j.set_size(20, 20);
                    }
                }
            }

            if(this.auto_hide && !global.settings.get_boolean("panel-edit-mode"))
                this._hideTimeoutId = Mainloop.timeout_add_seconds(this.hide_time, Lang.bind(this,function(this: MyApplet){this.autoHide(updateAlreadyHidden);}));
        }
        if (this.statusintooltip) {
            if (this.auto_hide)
                this.set_applet_tooltip(_("Autohide ON"));
            else
                this.set_applet_tooltip(_("Autohide OFF"));
        }
        this.doHide = !this.doHide;
    }

    on_panel_edit_mode_changed() {
        this.panelEditMode.setToggleState(global.settings.get_boolean("panel-edit-mode"));
        if (global.settings.get_boolean("panel-edit-mode")){
            if (!this.doHide){
                this.toggleHiding(true);
            }
        } else if (this.doHide){
            this.toggleHiding(true);
        }
    }

    on_orientation_changed(orientation: imports.gi.St.Side) {
        this.orientation = orientation;
    }

    autoHide(updateAlreadyHidden: boolean){
        let postpone=this.actor.hover && this.hover_activates;
        let _children = (this.cbox as imports.gi.Clutter.Actor).get_children();
        let p = _children.indexOf(this.actor);
        for(let i = 0; i < p; i++){
            postpone = postpone || _children[i].hover;
            if(_children[i]._applet._menuManager)
                postpone = postpone || _children[i]._applet._menuManager._activeMenu;
            if(_children[i]._applet.menuManager)
                postpone = postpone || _children[i]._applet.menuManager._activeMenu;
            if(postpone)
                break;
        }
        if (postpone)
            this._hideTimeoutId = Mainloop.timeout_add_seconds(this.hide_time, Lang.bind(this,function(this: MyApplet){this.autoHide(updateAlreadyHidden);}));
        else if (this.doHide && !global.settings.get_boolean("panel-edit-mode"))
            this.toggleHiding(updateAlreadyHidden);

    }

    on_applet_removed_from_panel() {
        if(!this.doHide){
            this.toggleHiding(true);
        }
    }

    on_applet_middle_clicked() {
        this.auto_hide = !this.auto_hide;
        if (this.itemAutohide) {
            this.itemAutohide._switch.setToggleState(this.auto_hide);
        }
        this.toggleHiding(this.auto_hide);
        return true;
    }

    is_vertical() {
        return this.orientation == St.Side.LEFT || this.orientation == St.Side.RIGHT;
    }
}

export function main(metadata: any, orientation: imports.gi.St.Side, panel_height: number, instance_id: number): MyApplet {
    let myApplet = new MyApplet(metadata, orientation, panel_height, instance_id);
    return myApplet;
}
