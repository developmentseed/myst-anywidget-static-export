// Counter widget JavaScript module
// Demonstrates basic anywidget patterns and inter-widget communication

function render({ model, el }) {
    // Create widget container
    const container = document.createElement('div');
    container.className = 'counter-widget';
    
    // Create label
    const label = document.createElement('h3');
    label.textContent = model.get('label');
    container.appendChild(label);
    
    // Create value display
    const valueDisplay = document.createElement('div');
    valueDisplay.className = 'counter-value';
    valueDisplay.textContent = model.get('value');
    container.appendChild(valueDisplay);
    
    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'counter-buttons';
    
    // Decrement button
    const decrementBtn = document.createElement('button');
    decrementBtn.textContent = '-';
    decrementBtn.onclick = () => {
        const currentValue = model.get('value');
        model.set('value', currentValue - 1);
        try { model.save_changes(); } catch(e) {}
    };
    buttonContainer.appendChild(decrementBtn);
    
    // Increment button
    const incrementBtn = document.createElement('button');
    incrementBtn.textContent = '+';
    incrementBtn.onclick = () => {
        const currentValue = model.get('value');
        model.set('value', currentValue + 1);
        try { model.save_changes(); } catch(e) {}
    };
    buttonContainer.appendChild(incrementBtn);
    
    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.onclick = () => {
        model.set('value', 0);
        try { model.save_changes(); } catch(e) {}
    };
    buttonContainer.appendChild(resetBtn);
    
    container.appendChild(buttonContainer);
    
    // Add info section
    const infoSection = document.createElement('div');
    infoSection.className = 'counter-info';
    infoSection.innerHTML = `<small>Widget ID: ${model.get('widget_id')}</small>`;
    container.appendChild(infoSection);
    
    // Update display when value changes
    model.on('change:value', () => {
        valueDisplay.textContent = model.get('value');
        valueDisplay.classList.add('value-changed');
        setTimeout(() => {
            valueDisplay.classList.remove('value-changed');
        }, 300);
    });
    
    // Update label when it changes
    model.on('change:label', () => {
        label.textContent = model.get('label');
    });
    
    // Append to element
    el.appendChild(container);
}

export default { render };
