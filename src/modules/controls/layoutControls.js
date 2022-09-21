import { SimpleEventerClass } from '../utils.js';

/**
 * A class that provides the functionality for a simple navigation bar. Exposes and 'item-selected' event.
 */
export class Navbar extends SimpleEventerClass {
	#navItems = null;

	/**
	 * A class that provides the functionality for a simple navigation bar. Exposes and 'item-selected' event.
	 * @param {*} containerElm The container element to insert the nav bar into.
	 * @param {*} navItems The navigation bar item settings.
	 * @param {*} minWidth The min-width of the nav bar when collapsed.
	 * @param {*} maxWidth The max-width of the nav bar when expanded.
	 */
	constructor(containerElm, navItems, minWidth, maxWidth) {
		super();

		const self = this;

		self.container = containerElm;

		self.minWidth = minWidth || '50px';
		self.maxWidth = maxWidth || '150px';

		//Add a container for buttons at the top.
		const topBtnContainer = document.createElement('div');
		topBtnContainer.classList.add('nav-top');
		self.container.appendChild(topBtnContainer);

		//Add a container for buttons at the bottom.
		const bottomBtnContainer = document.createElement('div');
		bottomBtnContainer.classList.add('nav-bottom');
		self.container.appendChild(bottomBtnContainer);

		self.#navItems = navItems || [];

		//Build the navbar.
		self.#navItems.forEach(x => {
			if (x.type === 'menuItem') {
				const btn = self.#buildBtn(x);

				if (x.position === 'bottom') {
					bottomBtnContainer.appendChild(btn);
				} else {
					topBtnContainer.appendChild(btn);
				}
			}
		});

		//Minimize the nav bar by default.
		self.minimize();
	}

	/**
	 * Set focus to the first button in the nav bar.
	 */
	focus() {
		this.container.querySelector('button').focus();
	}

	/**
	 * Maximize the nav bar.
	 */
	maximize() {
		const self = this;
		self.container.style.width = self.maxWidth;
		self.#setLabelDisplay('');

		if (self.expandBtn) {
			self.expandBtn.style.display = 'none';
		}

		if (self.collpaseBtn) {
			self.collpaseBtn.style.display = '';
		}
	}

	/**
	 * Minimize the nav bar.
	 */
	minimize() {
		const self = this;
		self.container.style.width = self.minWidth;
		self.#setLabelDisplay('none');

		if (self.expandBtn) {
			self.expandBtn.style.display = '';
		}

		if (self.collpaseBtn) {
			self.collpaseBtn.style.display = 'none';
		}
	}

	/**
	 * Toggle the min/max state of the nav bar.
	 */
	toggle() {
		const self = this;
		(self.isMaximized()) ? self.minimize() : self.maximize();
	}

	/**
	 * Check to see if nav bar is maximized.
	 * @returns A boolean indicating if the nav bar is maximized.
	 */
	isMaximized() {
		return parseInt(this.container.style.width) !== parseInt(this.minWidth);
	}

	/**
	 * Sets the selected item in the nav bar.
	 * @param {*} itemOrName The item object or name of the item.
	 */
	setSelectedItem(itemOrName) {
		//Get the name of the item.
		const name = (typeof itemOrName === 'string') ? itemOrName : itemOrName.name;

		//Loop through the nav bar items and find the matching element and set to active state. Set non-matching elements to netural state.
		this.#navItems.forEach(x => {
			if (x.type === 'menuItem') {
				if (x.name === name) {
					x.btn.classList.add('selected-navbar-item');
					x.btn.setAttribute('aria-pressed', 'true');
					this.trigger('item-selected', x);
				} else {
					x.btn.classList.remove('selected-navbar-item');
					x.btn.setAttribute('aria-pressed', 'false');
				}
			}
		});
	}

	/**
	 * Sets the display style of the text labels in the nav bar.
	 * @param {*} display The display style value.
	 */
	#setLabelDisplay(display) {
		this.container.querySelectorAll('span').forEach(x => x.style.display = display);
	}

	/**
	 * Creates a nav bar button from an item settings.
	 * @param {*} item The nav bar item settings.
	 * @returns The button element.
	 */
	#buildBtn(item) {
		const self = this;
		//<button class="icon-btn"><i class="material-symbols-outlined">info</i><span>Instructions</span></button> 

		//Create a button element with an icon and a text label. 
		const btn = document.createElement('button');
		btn.className = 'icon-btn';
		btn.title = item.name;
		btn.setAttribute('role', 'button');
		btn.setAttribute('aria-pressed', 'false');
		btn.innerHTML = `<i class="material-symbols-outlined">${item.icon}</i><span>${item.name}</span>`;

		//Capture and add click events to "Collapse" and "Expand" buttons. Add a click event to set the select item to all other buttons.
		if (item.name === 'Collapse') {
			self.collpaseBtn = btn;

			btn.onclick = () => {
				self.minimize();
			};
		} else if (item.name === 'Expand') {
			self.expandBtn = btn;

			btn.onclick = () => {
				self.maximize();
			};
		} else {
			btn.onclick = () => {
				self.setSelectedItem(item);
			}
		}

		//Link the button to the item settings for easier cross matching later.
		item.btn = btn;

		return btn;
	}
}

/**
 * A class that provides the functionality a flyout panel beside the nav bar. Exposes and 'closed' event.
 */
export class Flyout extends SimpleEventerClass {
	#currentItem = null;
	#items = [];

	/**
	 * A class that provides the functionality a flyout panel beside the nav bar. Exposes and 'closed' event.
	 * @param {*} elm The HTML element the contains the content of the flyout.
	 * @param {*} items An array of item settings for each flyout.
	 */
	constructor(elm, items) {
		super();

		const self = this;
		self.elm = elm;
		self.#items = items;
		self.header = elm.querySelector('.flyout-header');

		//Wire up the close button for the flyout panel.
		self.closeBtn = self.header.querySelector('.flyout-header-close-btn');

		self.closeBtn.onclick = () => {
			self.hide();
		};

		//Hide the flyout by default.
		self.hide();
	}

	/**
	 * Check to see if an item is the current item. 
	 * @param {*} item An item to check. 
	 * @returns A boolean indicating if an item is the current item. 
	 */
	isCurrentItem(item) {
		return this.#currentItem === item;
	}

	/**
	 * Shows a flyout item.
	 * @param {*} item The item toflyout show, or name of the flyout item.
	 */
	show(item) {
		const self = this;

		//If the name of a flyout item provided, try and find a matching setting.
		if (typeof item === 'string') {
			self.#items.forEach(x => {
				if (x.flyoutCard === item) {
					item = x;
				}
			});
		}

		//We should have a flyout item setting object now if a valid value was passed in. 
		if (typeof item !== 'string') {
			self.#currentItem = item;

			//Set the header name of the flyout for the current select flyout panel.
			self.header.querySelector('span').innerHTML = item.name;

			//Set the visibility of all flyout panels such that only the selected lyout is displayed.
			if (item.flyoutCard) {
				Array.from(self.elm.querySelector('.flyout-content').children).forEach(c => {
					if (c.id === item.flyoutCard) {
						c.style.display = '';
						self.elm.style.display = '';
					} else {
						c.style.display = 'none';
					}
				});

				//Set the tab focus to the close button of the flyout.
				self.closeBtn.focus()
			}
		}
	}

	/**
	 * Hides the flyout panel and triggers the "closed" event.
	 */
	hide() {
		const self = this;
		self.elm.style.display = 'none';
		self.#currentItem = null;

		//Trigger the "closed" event.
		self.trigger('closed');
	}

	/**
	 * Checks to see if the flyout panel is open.
	 * @returns A boolean indicating if the flyout panel is open.
	 */
	isOpen() {
		return this.elm.style.display !== 'none';
	}
}
