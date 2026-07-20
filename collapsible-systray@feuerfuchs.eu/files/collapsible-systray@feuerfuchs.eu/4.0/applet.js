const uuid = "collapsible-systray@feuerfuchs.eu";

const Clutter                   = imports.gi.Clutter;
const St                        = imports.gi.St;
const GLib                      = imports.gi.GLib;
const Mainloop                  = imports.mainloop;
const Settings                  = imports.ui.settings;

const PopupMenu                 = imports.ui.popupMenu;

let CinnamonSystray, CSCollapseBtn, CSRemovableSwitchMenuItem, _;
if (typeof require !== 'undefined') {
    CinnamonSystray             = require('./CinnamonSystray');
    CSCollapseBtn               = require('./CSCollapseBtn');
    CSRemovableSwitchMenuItem   = require('./CSRemovableSwitchMenuItem');
    _                           = require('./Util')._;
} else {
    const AppletDir             = imports.ui.appletManager.applets[uuid];
    CinnamonSystray             = AppletDir.CinnamonSystray;
    CSCollapseBtn               = AppletDir.CSCollapseBtn;
    CSRemovableSwitchMenuItem   = AppletDir.CSRemovableSwitchMenuItem;
    _                           = AppletDir.Util._;
}

// ------------------------------------------------------------------------------------------------------

class CollapsibleSystrayApplet extends CinnamonSystray.CinnamonSystrayApplet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.Menu = {
            ACTIVE_APPLICATIONS:   true,
            INACTIVE_APPLICATIONS: false
        };
    
        this.Direction = {
            HORIZONTAL: 0,
            VERTICAL:   1
        };

        this.actor.add_style_class_name("ff-collapsible-systray");

        // The base class adds its own button_box; we manage our own layout instead.
        this.actor.remove_actor(this.button_box);

        //
        // Variables

        this._direction              = (orientation == St.Side.TOP || orientation == St.Side.BOTTOM) ? this.Direction.HORIZONTAL : this.Direction.VERTICAL;
        this._hovering               = false;
        this._hoverTimerID           = null;
        this._initialCollapseTimerID = null;
        this._registeredButtons      = {};
        this._activeMenuItems        = {};
        this._inactiveMenuItems      = {};
        this._animating              = false;
        this._iconsAreHidden         = false;
        this.iconVisibilityList      = {};

        //
        // Expand/collapse button

        this.collapseBtn = new CSCollapseBtn.CSCollapseBtn(this);
        this.collapseBtn.actor.connect('clicked', (o, event) => {
            this._cancelHoverTimer();
            this._cancelInitialCollapseTimer();

            switch (this.collapseBtn.state) {
                case this.collapseBtn.State.EXPANDED:
                    this._hideAppIcons(true);
                    break;

                case this.collapseBtn.State.COLLAPSED:
                    this._showAppIcons(true);
                    break;

                case this.collapseBtn.State.UNAVAILABLE:
                    this._applet_context_menu.toggle();
                    break;
            }
        });

        //
        // Layout: [ collapse button ][ hidden icons ][ shown icons ]

        const vertical = this._direction == this.Direction.VERTICAL;

        this.mainLayout           = new St.BoxLayout({ vertical: vertical });
        this.hiddenIconsContainer = new St.BoxLayout({ vertical: vertical });
        this.shownIconsContainer  = new St.BoxLayout({ vertical: vertical });

        // Clip the hidden container so its children get visually "eaten" by the
        // collapse button as it shrinks to zero during the collapse animation.
        this.hiddenIconsContainer.clip_to_allocation = true;

        this.mainLayout.add_actor(this.collapseBtn.actor);
        this.mainLayout.add_actor(this.hiddenIconsContainer);
        this.mainLayout.add_actor(this.shownIconsContainer);
        this.actor.add_actor(this.mainLayout);

        //
        // Context menu items

        this.cmitemActiveItems   = new PopupMenu.PopupSubMenuMenuItem(_("Active applications"));
        this.cmitemInactiveItems = new PopupMenu.PopupSubMenuMenuItem(_("Inactive applications"));

        this._populateMenus();

        //
        // Settings

        this._settings = new Settings.AppletSettings(this, uuid, instance_id);
        this._settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "icon-visibility-list",          "savedIconVisibilityList",    this._loadAppIconVisibilityList);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "init-delay",                    "initDelay");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "animation-support",             "animationSupport",           this._onAnimationSupportUpdated);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "animation-duration",            "animationDuration");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "horizontal-expand-icon-name",   "horizontalExpandIconName",   this._onExpandCollapseIconNameUpdated);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "horizontal-collapse-icon-name", "horizontalCollapseIconName", this._onExpandCollapseIconNameUpdated);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "vertical-expand-icon-name",     "verticalExpandIconName",     this._onExpandCollapseIconNameUpdated);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "vertical-collapse-icon-name",   "verticalCollapseIconName",   this._onExpandCollapseIconNameUpdated);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "tray-icon-padding",             "trayIconPadding",            this._onTrayIconPaddingUpdated);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover",               "expandOnHover");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover-delay",         "expandOnHoverDelay");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave",             "collapseOnLeave");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave-delay",       "collapseOnLeaveDelay");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "no-hover-for-tray-icons",       "noHoverForTrayIcons");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "sort-icons",                    "sortIcons");

        this._loadAppIconVisibilityList();
        this.collapseBtn.setVertical(this._direction == this.Direction.VERTICAL);
        this.collapseBtn.refreshReactive();

        global.log("[" + uuid + "] Initialized");
    }

    /*
     * Cancel the hover (expand/collapse-on-hover) timer if one is pending.
     */
    _cancelHoverTimer() {
        if (this._hoverTimerID) {
            Mainloop.source_remove(this._hoverTimerID);
            this._hoverTimerID = null;
        }
    }

    /*
     * Cancel the startup auto-collapse timer if one is pending.
     */
    _cancelInitialCollapseTimer() {
        if (this._initialCollapseTimerID) {
            Mainloop.source_remove(this._initialCollapseTimerID);
            this._initialCollapseTimerID = null;
        }
    }

    /*
     * Get the correct collapse icon according to the user settings and the applet orientation
     */
    get collapseIcon() {
        if (this._direction == this.Direction.HORIZONTAL) {
            return this.horizontalCollapseIconName;
        } else {
            return this.verticalCollapseIconName;
        }
    }

    /*
     * Get the correct expand icon according to the user settings and the applet orientation
     */
    get expandIcon() {
        if (this._direction == this.Direction.HORIZONTAL) {
            return this.horizontalExpandIconName;
        } else {
            return this.verticalExpandIconName;
        }
    }

    /*
     * Set the collapse button's state
     */
    _refreshCollapseBtnState() {
        let collapsible = false;
        for (let id in this.iconVisibilityList) {
            if (this.iconVisibilityList.hasOwnProperty(id) && this._registeredButtons.hasOwnProperty(id)) {
                if (!this.iconVisibilityList[id]) {
                    collapsible = true;
                    break;
                }
            }
        }

        if (collapsible) {
            this.collapseBtn.setState(this._iconsAreHidden ? this.collapseBtn.State.COLLAPSED : this.collapseBtn.State.EXPANDED);
        } else {
            this.collapseBtn.setState(this.collapseBtn.State.UNAVAILABLE);
        }
    }

    /*
     * Add all necessary menu items to the context menu
     */
    _populateMenus() {
        let i = -1;
        this._applet_context_menu.addMenuItem(this.cmitemActiveItems, ++i);
        this._applet_context_menu.addMenuItem(this.cmitemInactiveItems, ++i);
        this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), ++i);
    }

    /*
     * Apply the configured tray icon padding to a button wrapper.
     */
    _applyButtonPadding(button) {
        if (this._direction == this.Direction.HORIZONTAL) {
            button.set_style('padding-left: ' + this.trayIconPadding + 'px; padding-right: ' + this.trayIconPadding + 'px;');
        } else {
            button.set_style('padding-top: ' + this.trayIconPadding + 'px; padding-bottom: ' + this.trayIconPadding + 'px;');
        }
    }

    /*
     * Insert a button into a container, keeping the alphabetical order if enabled.
     */
    _insertButtonSorted(container, button, id) {
        let index = 0;
        if (this.sortIcons) {
            const children = container.get_children();
            for (let len = children.length; index < len; ++index) {
                if (children[index].appID && children[index].appID.localeCompare(id) >= 1) {
                    break;
                }
            }
        }
        container.insert_child_at_index(button, index);
    }

    /*
     * Override hook: a new tray button was created by the base class. Register it
     * and place it in the appropriate container instead of the default button box.
     */
    _addTrayButton(button, role) {
        this._registerAppIcon(role, button);
    }

    /*
     * Add the specified tray button to the item list and create a menu entry
     */
    _registerAppIcon(id, button) {
        if (!this._registeredButtons.hasOwnProperty(id)) {
            this._registeredButtons[id] = [];
        }

        const instanceArray = this._registeredButtons[id];

        if (instanceArray.indexOf(button) != -1) return;

        global.log("[" + uuid + "] Register instance of " + id);

        instanceArray.push(button);
        button.appID = id;

        if (!this.iconVisibilityList.hasOwnProperty(id)) {
            this.iconVisibilityList[id] = true;
            this._saveAppIconVisibilityList();
        }

        const visible   = this.iconVisibilityList[id];
        const container = visible ? this.shownIconsContainer : this.hiddenIconsContainer;

        this._insertButtonSorted(container, button, id);
        this._applyButtonPadding(button);

        if (this._iconsAreHidden && !visible) {
            button.hide();
        }

        this._addApplicationMenuItem(id, this.Menu.ACTIVE_APPLICATIONS);
        this._refreshCollapseBtnState();
    }

    /*
     * Remove the button from the list and move the menu entry to the list of inactive applications
     */
    _unregisterAppIcon(id, button) {
        global.log("[" + uuid + "] Unregister instance of " + id);

        const instanceArray = this._registeredButtons[id];
        if (!instanceArray) {
            return;
        }

        const iconIndex = instanceArray.indexOf(button);
        if (iconIndex != -1) {
            instanceArray.splice(iconIndex, 1);
        }

        if (instanceArray.length == 0) {
            global.log("[" + uuid + "] No more instances left");

            delete this._registeredButtons[id];
            this._addApplicationMenuItem(id, this.Menu.INACTIVE_APPLICATIONS);
            this._refreshCollapseBtnState();
        }
    }

    /*
     * Create a menu entry for the specified icon in the "active applications" section
     */
    _addApplicationMenuItem(id, menu) {
        const curMenuItems   = menu == this.Menu.ACTIVE_APPLICATIONS ? this._activeMenuItems       : this._inactiveMenuItems;
        const curMenu        = menu == this.Menu.ACTIVE_APPLICATIONS ? this.cmitemActiveItems.menu : this.cmitemInactiveItems.menu;
        const otherMenuItems = menu == this.Menu.ACTIVE_APPLICATIONS ? this._inactiveMenuItems     : this._activeMenuItems;
        let   menuItem       = null;

        // If there's a menu item in the other menu, delete it
        if (otherMenuItems.hasOwnProperty(id)) {
            otherMenuItems[id].actor.destroy();
            delete otherMenuItems[id];
        }

        // If there's already a menu item in the current menu, do nothing
        if (curMenuItems.hasOwnProperty(id)) {
            return;
        }

        global.log("[" + uuid + "] Insert menu item for " + id + " in " + (menu == this.Menu.ACTIVE_APPLICATIONS ? "active" : "inactive") + " applications");

        switch (menu) {
            case this.Menu.ACTIVE_APPLICATIONS:
                menuItem = new PopupMenu.PopupSwitchMenuItem(id, this.iconVisibilityList[id]);
                menuItem.appID = id;
                menuItem.connect('toggled', (o, state) => {
                    this._updateAppIconVisibility(id, state);
                });
                break;

            default:
            case this.Menu.INACTIVE_APPLICATIONS:
                menuItem = new CSRemovableSwitchMenuItem.CSRemovableSwitchMenuItem(id, this.iconVisibilityList[id]);
                menuItem.appID = id;
                menuItem.connect('toggled', (o, state) => {
                    this._updateAppIconVisibility(id, state);
                });
                menuItem.connect('remove', (o, state) => {
                    delete this.iconVisibilityList[id];
                    this._saveAppIconVisibilityList();

                    delete this._inactiveMenuItems[id];
                });
                break;
        }

        // Find insertion index so all menu items are alphabetically sorted
        let   index = 0;
        const items = curMenu._getMenuItems();
        for (let len = items.length; index < len; ++index) {
            if (items[index].appID.localeCompare(id) >= 1) {
                break;
            }
        }

        curMenu.addMenuItem(menuItem, index);
        curMenuItems[id] = menuItem;
    }

    /*
     * Hide all icons that are marked as hidden
     */
    _hideAppIcons(animate) {
        if (this._animating) {
            this.hiddenIconsContainer.remove_all_transitions();
            this._animating = false;
        }

        global.log("[" + uuid + "] _hideAppIcons");

        this._iconsAreHidden = true;

        const container  = this.hiddenIconsContainer;
        const horizontal = this._direction == this.Direction.HORIZONTAL;

        const finish = () => {
            this._animating = false;
            if (horizontal) {
                container.set_width(0);
            } else {
                container.set_height(0);
            }
            container.get_children().forEach((button) => { button.hide(); });
            this._refreshCollapseBtnState();
        };

        if (animate && this.animationSupport && this.animationDuration > 0) {
            this._animating = true;

            const easeParams = {
                duration:   this.animationDuration,
                mode:       Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: finish
            };
            if (horizontal) {
                easeParams.width = 0;
            } else {
                easeParams.height = 0;
            }
            container.ease(easeParams);
        } else {
            finish();
        }
    }

    /*
     * Unhide all icons that are marked as hidden
     */
    _showAppIcons(animate) {
        if (this._animating) {
            this.hiddenIconsContainer.remove_all_transitions();
            this._animating = false;
        }

        global.log("[" + uuid + "] _showAppIcons");

        this._iconsAreHidden = false;

        const container  = this.hiddenIconsContainer;
        const horizontal = this._direction == this.Direction.HORIZONTAL;

        container.get_children().forEach((button) => { button.show(); });

        const finish = () => {
            this._animating = false;
            if (horizontal) {
                container.set_width(-1);
            } else {
                container.set_height(-1);
            }
            this._refreshCollapseBtnState();
        };

        if (animate && this.animationSupport && this.animationDuration > 0) {
            this._animating = true;

            // Measure the natural size, then animate from 0 to it.
            let target;
            if (horizontal) {
                container.set_width(-1);
                [, target] = container.get_preferred_width(-1);
                container.set_width(0);
            } else {
                container.set_height(-1);
                [, target] = container.get_preferred_height(-1);
                container.set_height(0);
            }

            const easeParams = {
                duration:   this.animationDuration,
                mode:       Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: finish
            };
            if (horizontal) {
                easeParams.width = target;
            } else {
                easeParams.height = target;
            }
            container.ease(easeParams);
        } else {
            finish();
        }
    }

    /*
     * Update the specified icon's visibility state and (un)hide it if necessary
     */
    _updateAppIconVisibility(id, state) {
        global.log("[" + uuid + "] State of " + id + " was set to " + (state ? "shown" : "hidden"));

        this.iconVisibilityList[id] = state;

        // Application is active, move its button(s) to the appropriate container
        if (this._registeredButtons.hasOwnProperty(id)) {
            const buttons   = this._registeredButtons[id];
            const container = state ? this.shownIconsContainer : this.hiddenIconsContainer;

            buttons.forEach((button) => {
                const parent = button.get_parent();
                if (parent) {
                    parent.remove_child(button);
                }
                this._insertButtonSorted(container, button, id);

                if (this._iconsAreHidden) {
                    if (state) {
                        button.show();
                    } else {
                        button.hide();
                    }
                }
            });
        }

        this._saveAppIconVisibilityList();
        this._refreshCollapseBtnState();
    }

    /*
     * Update the tray icons' padding
     */
    _updateTrayIconPadding() {
        this.shownIconsContainer.get_children()
            .concat(this.hiddenIconsContainer.get_children())
            .forEach((button) => {
                this._applyButtonPadding(button);
            });
    }

    /*
     * Load the list of hidden icons from the settings
     */
    _loadAppIconVisibilityList() {
        try {
            this.iconVisibilityList = JSON.parse(this.savedIconVisibilityList);

            this._refreshCollapseBtnState();

            for (let id in this.iconVisibilityList) {
                if (this.iconVisibilityList.hasOwnProperty(id) && !this._registeredButtons.hasOwnProperty(id)) {
                    this._addApplicationMenuItem(id, this.Menu.INACTIVE_APPLICATIONS);
                }
            }
        } catch(e) {
            this.iconVisibilityList = {};
            global.log("[" + uuid + "] Chouldn't load icon visibility list: " + e);
        }
    }

    /*
     * Save the list of hidden icons
     */
    _saveAppIconVisibilityList() {
        this.savedIconVisibilityList = JSON.stringify(this.iconVisibilityList);
    }

    /*
     * An applet setting with visual impact has been changed
     */
    _onExpandCollapseIconNameUpdated(value) {
        this._refreshCollapseBtnState();
    }

    /*
     * An applet setting with visual impact has been changed
     */
    _onTrayIconPaddingUpdated(value) {
        this._updateTrayIconPadding();
    }

    /*
     * An applet setting with visual impact has been changed
     */
    _onAnimationSupportUpdated(value) {
        // When animation is toggled on, make sure the current collapsed/expanded
        // state is reflected without a stale in-flight transition.
        if (this._animating) {
            this.hiddenIconsContainer.remove_all_transitions();
            this._animating = false;
        }

        if (this._iconsAreHidden) {
            this._hideAppIcons(false);
        } else {
            this._showAppIcons(false);
        }
    }

    //
    // Events
    // ---------------------------------------------------------------------------------

    _onEnter() {
        this._hovering = true;

        this._cancelHoverTimer();

        if (!this.expandOnHover)      return;
        if (!this._draggable.inhibit) return;

        this._cancelInitialCollapseTimer();

        this._hoverTimerID = Mainloop.timeout_add(this.expandOnHoverDelay, () => {
            this._hoverTimerID = null;

            if (this._iconsAreHidden) {
                this._showAppIcons(true);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _onLeave() {
        this._hovering = false;

        this._cancelHoverTimer();

        if (!this.collapseOnLeave)    return;
        if (!this._draggable.inhibit) return;

        this._cancelInitialCollapseTimer();

        this._hoverTimerID = Mainloop.timeout_add(this.collapseOnLeaveDelay, () => {
            this._hoverTimerID = null;

            if (!this._iconsAreHidden) {
                this._hideAppIcons(true);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    //
    // Overrides
    // ---------------------------------------------------------------------------------

    /*
     * The panel edit mode changed. Keep the base behavior (icon resize) and update
     * the collapse button's reactivity so it can be dragged while editing the panel.
     */
    on_panel_edit_mode_changed() {
        super.on_panel_edit_mode_changed();

        if (this.collapseBtn) {
            this.collapseBtn.refreshReactive();
        }
    }

    /*
     * Override hook: clear all tray buttons from both containers. Icons are detached
     * (not destroyed) so the na-tray can reuse them on the following redisplay.
     */
    _clearIcons() {
        const buttons = this.shownIconsContainer.get_children()
            .concat(this.hiddenIconsContainer.get_children());

        buttons.forEach((button) => {
            const icon = button.child;
            if (icon) {
                button.remove_actor(icon);
            }
            button.destroy();
        });

        this._registeredButtons = {};
    }

    /*
     * Override hook: wrap the tray icon in an "applet-box" like the stock applet,
     * with our own style class so it can be themed separately.
     */
    _createTrayButton(icon) {
        const button = super._createTrayButton(icon);
        button.add_style_class_name('ff-collapsible-systray__status-icon');
        return button;
    }

    /*
     * Override hook: a tray icon was removed. Detach and destroy its button and
     * move the corresponding menu entry to the "inactive applications" section.
     */
    _onTrayIconRemoved(o, icon) {
        const button = icon.get_parent();
        if (!button) {
            return;
        }

        const id = button.appID;

        button.remove_actor(icon);
        button.destroy();

        if (id !== undefined) {
            this._unregisterAppIcon(id, button);
        }
    }

    /*
     * Override hook: respect the "disable hover effect for tray icons" setting.
     */
    _onEvent(icon, event) {
        if (this.noHoverForTrayIcons) {
            const etype = event.type();

            if (etype === Clutter.EventType.ENTER || etype === Clutter.EventType.LEAVE) {
                return icon.handle_event(etype, event);
            }
        }

        return super._onEvent(icon, event);
    }

    /*
     * The applet's orientation changed; adapt accordingly
     */
    on_orientation_changed(orientation) {
        global.log("[" + uuid + "] Event: on_orientation_changed");

        super.on_orientation_changed(orientation);

        this._direction = (orientation == St.Side.TOP || orientation == St.Side.BOTTOM) ? this.Direction.HORIZONTAL : this.Direction.VERTICAL;

        const vertical = this._direction == this.Direction.VERTICAL;

        this.mainLayout.set_vertical(vertical);
        this.hiddenIconsContainer.set_vertical(vertical);
        this.shownIconsContainer.set_vertical(vertical);
        this.collapseBtn.setVertical(vertical);

        // Re-apply padding so it matches the new orientation.
        this._updateTrayIconPadding();
    }

    /*
     * The applet has been added to the panel
     */
    on_applet_added_to_panel() {
        global.log("[" + uuid + "] Event: on_applet_added_to_panel");

        super.on_applet_added_to_panel();

        this._showAppIcons(false);

        //
        // Automatically collapse after X seconds

        this._initialCollapseTimerID = Mainloop.timeout_add(this.initDelay * 1000, () => {
            this._initialCollapseTimerID = null;

            if (this._draggable.inhibit) {
                this._hideAppIcons(true);
            }

            return GLib.SOURCE_REMOVE;
        });

        //
        // Hover events

        this._signalManager.connect(this.actor, 'enter-event', this._onEnter, this);
        this._signalManager.connect(this.actor, 'leave-event', this._onLeave, this);
    }

    /*
     * The applet has been removed from the panel; clean up timers and save settings
     */
    on_applet_removed_from_panel() {
        global.log("[" + uuid + "] Event: on_applet_removed_from_panel");

        this._cancelHoverTimer();
        this._cancelInitialCollapseTimer();

        super.on_applet_removed_from_panel();

        this._settings.finalize();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CollapsibleSystrayApplet(orientation, panel_height, instance_id);
}
