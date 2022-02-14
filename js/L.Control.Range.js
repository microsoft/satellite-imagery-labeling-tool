// Copyright (c) 2016 Conservation Biology Institute
// All rights reserved.

// Redistribution and use in source and binary forms, with or without
// modification, are permitted.

// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

L.Control.Range = L.Control.extend({
    options: {
        position: 'topright',
        min: 0,
        max: 100,
        value: 0,
        step: 1,
        orient: 'vertical',
        iconClass: 'leaflet-range-icon',
        icon: true,
        label: "Text",
    },

    onAdd: function(map) {
        var container = L.DomUtil.create('div', 'leaflet-range-control leaflet-bar ' + this.options.orient);
        if (this.options.icon) {
          var iconSpan = L.DomUtil.create('span', this.options.iconClass, container);
          console.debug(iconSpan);
          $(iconSpan).html(this.options.label);
        };
        var slider = L.DomUtil.create('input', '', container);
        slider.type = 'range';
        slider.setAttribute('orient', this.options.orient);
        slider.min = this.options.min;
        slider.max = this.options.max;
        slider.step = this.options.step;
        slider.value = this.options.value;

        L.DomEvent.on(slider, 'mousedown mouseup click touchstart', L.DomEvent.stopPropagation);

        /* IE11 seems to process events in the wrong order, so the only way to prevent map movement while dragging the
         * slider is to disable map dragging when the cursor enters the slider (by the time the mousedown event fires
         * it's too late becuase the event seems to go to the map first, which results in any subsequent motion
         * resulting in map movement even after map.dragging.disable() is called.
         */
        L.DomEvent.on(slider, 'mouseenter', function(e) {
            map.dragging.disable()
        });
        L.DomEvent.on(slider, 'mouseleave', function(e) {
            map.dragging.enable();
        });

        L.DomEvent.on(slider, 'change', function(e) {
            this.fire('change', {value: e.target.value});
        }.bind(this));

        L.DomEvent.on(slider, 'input', function(e) {
            this.fire('input', {value: e.target.value});
        }.bind(this));

        this._slider = slider;
        this._container = container;

        return this._container;
    },

    setValue: function(value) {
        this.options.value = value;
        this._slider.value = value;
    },

});

L.Control.Range.include(L.Evented.prototype)

L.control.range = function (options) {
  return new L.Control.Range(options);
};
