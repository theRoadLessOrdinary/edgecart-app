;
HTMLElement.prototype.enhanced_checkbox = function (options) {
	const el = this;

	const name 	    = el.getAttribute('name');
	const id 	      = el.getAttribute('id');
	const value     = el.getAttribute('value');
	const classname = el.getAttribute('class');

	// Default options
	const defaultOptions = {
		before_render: function () {},
		after_render: function () {},
		checked: 1,
		unchecked: 0 ,
		control: 'hidden'
	};

	// Merge default options with provided options
	const mergedOptions = { ...defaultOptions, ...options };

	// Access the options
	const {
	before_render,
	after_render,
		    checked,
		    unchecked,
		    control
	} = mergedOptions;

	// override from element attributes
	for (let i = 0; i < el.attributes.length; i++) {
		const attr = el.attributes[i];
		const attrName = attr.name;
		mergedOptions[attrName] = attr.value;
	}

	// call the before_render function. If none is defined, this does nothing.
	mergedOptions.before_render();

	// Create a new checkbox element
	const checkbox 		= document.createElement('input');
	checkbox.type 		= 'checkbox';
	// the name of the generated checkbox doesn't matter, so a random string is used
	checkbox.name 		= `checkbox_${Math.random().toString(36).substring(9)}`;
	checkbox.checked 	= value === mergedOptions.checked;
	checkbox.title		= (el.title) ? el.title: '';
	checkbox.setAttribute('class', classname);

	// Create a hidden input element (or text, or whatever control has been passed as an option or attribute)
	const hiddenInput 	= document.createElement('input');
	hiddenInput.type 	= mergedOptions.control;
	hiddenInput.name 	= name;
	hiddenInput.id 		= (id) ? id: name;
	hiddenInput.value 	= value;

	const notHidden = ('title,class,id,name,value,checked,unchecked').split(',');

	// Copy other attributes from enh-checkbox to hidden input
	for (let i = 0; i < el.attributes.length; i++) {
		const attr = el.attributes[i];
		const attrName = attr.name;
		if (!notHidden.includes(attrName) ) {
			hiddenInput.setAttribute(attrName, attr.value);
		}
	}

	// Add the checkbox and hidden input to the DOM
	const pn = el.parentNode;
	pn.replaceChild(checkbox, el);
	pn.parentNode.appendChild(hiddenInput);
	// Add a click event listener to the checkbox
	checkbox.addEventListener('click', () => {
		hiddenInput.value = checkbox.checked ? mergedOptions.checked : mergedOptions.unchecked;
	});

	// call the after_render function. If none is defined, this does nothing.
	mergedOptions.after_render();

};
