const St        = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;

// ------------------------------------------------------------------------------------------------------

// A PopupSwitchMenuItem that also shows a "remove" button, used to let the user
// delete saved entries for applications that are no longer running.
class CSRemovableSwitchMenuItem extends PopupMenu.PopupSwitchMenuItem {
    constructor(text, active, params) {
        super(text, active, params);

        const iconDelete = new St.Icon({
            icon_name:   'edit-delete',
            icon_type:   St.IconType.SYMBOLIC,
            style_class: 'popup-menu-icon'
        });
        this.deleteButton = new St.Button({ child: iconDelete });
        this.deleteButton.connect('clicked', () => this.remove());

        // The base class puts the switch alone in a single-child St.Bin. Replace it
        // with a horizontal box that holds both the switch and the delete button.
        this._statusBin.child = null;
        this.removeActor(this._statusBin);

        this._statusBin = new St.BoxLayout({
            vertical: false,
            style:    'spacing: 6px;',
            x_align:  St.Align.END
        });
        this.addActor(this._statusBin, { expand: true, span: -1, align: St.Align.END });
        this._statusBin.add_child(this._switch.actor);
        this._statusBin.add_child(this.deleteButton);
    }

    /*
     * User clicked the "remove" button
     */
    remove() {
        this.emit('remove');
        this.destroy();
    }
}
