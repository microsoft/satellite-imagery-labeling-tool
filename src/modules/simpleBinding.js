/**
 * A simple binding class that adds one-way binding to HTMLElements to a JSON object.
 */
export class SimpleBinding {
    #target = null;
    #events = {};//event = { elm, callback };

    /**
     * Adds one-way binding to HTMLElements to a JSON object.
     * @param target The target object to bind to. 
     */
    constructor(target) {
        this.#target = target;
    }

    /**
     * Disposes the bindings and frees the resources.
     */
    dispose() {
        const self = this;
        const e = self.#events;

        //Event names
        const events = Object.keys(self.#events);

        events.forEach(n => {
            events[n].elm.removeEventListener(n, events[n].callack);
        });

        self.#events = null;
        self.#target = null;
    }

    /**
     * Binds ane element value to propery value in the object.
     * @param elm Element to bind to.
     * @param propName The property name to add the values to in the target object.
     * @param isCheckboxArray Specifies if the element is part of a group of checkbox inputs that should be grouped into a single property as an array of values.
     * @param changeCallback A callback function to trigger when a change occurs. Passes in the property name and value.
     */
    bind(elm, propName, isCheckboxArray, changeCallback) {
        const self = this;
        if (elm) {

            const tagName = elm.tagName.toLowerCase();
            const eventName = ((tagName === 'input' && elm.type === 'text') || tagName === 'textarea') ? 'onkeyup' : 'onchange';
            const names = propName.split('.');

            self.#addEvent(elm, eventName, () => {
                let val = elm.value;
                let e = elm;

                if (tagName === 'label') {
                    e = elm.firstChild;
                }

                if (tagName === 'input') {
                    let input = e;
                    switch (input.type) {
                        case 'number':
                            val = parseFloat(val);
                            break;
                        case 'checkbox':
                            if (isCheckboxArray) {
                                let items = self.#getValue(names);

                                if (!items) {
                                    items = [];
                                }

                                const idx = items.indexOf(input.value);

                                if (input.checked && idx === -1) {
                                    items.push(input.value);
                                } else if (!input.checked && idx > -1) {
                                    items = items.splice(idx, 1);
                                }

                                val = items;
                            } else {
                                val = input.checked;
                            }
                            break;
                    }
                } else if(tagName === 'select'){
                    val = elm.options[elm.selectedIndex].value;
                }

                self.#setValue(names, val);

                if (changeCallback) {
                    changeCallback(names, val);
                }
            });
            elm[eventName](new Event(eventName));
        }

        return self;
    }

    /**
     * Gets the value for property name path.
     * @param {*} names Property name path.
     * @returns The value of the propertry.
     */
    #getValue(names) {        
        let t = this.#target;

        for (let i = 0; i < names.length; i++) {
            t = t[names[i]];
        }

        return t;
    }

    /**
     * Sets the value of a property by property name path.
     * @param {*} names Property name path.
     * @param {*} val The value of the propertry.
     */
    #setValue(names, val) {
        let t = this.#target;
        for (let i = 0; i < names.length - 1; i++) {
            t = t[names[i]];
        }

        t[names[names.length - 1]] = val;
    }

    /**
     * Adds an event to the binded element.
     * @param elm The element to add the event to.
     * @param name The event name.
     * @param callback The callback handler for the event.
     */
    #addEvent(elm, name, callback) {
        if (elm && name && callback) {
            const e = this.#events;

            if (!e[name]) {
                e[name] = [];
            }

            e[name].push({
                elm: elm,
                callack: callback
            });

            elm.addEventListener(name, callback);
            elm[name] = callback;
        }
    }
}