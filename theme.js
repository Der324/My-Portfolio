 // Wait for DOM to be fully loaded
(function() {
    'use strict';
    
    const toggle = document.getElementById("contact-toggle");
    const details = document.getElementById("contact-details");
    
    if (!toggle || !details) {
        console.error('Contact toggle or details element not found');
        return;
    }
    
    // Initialize state
    details.style.display = "none";
    
    toggle.addEventListener("click", function() {
        const isOpen = details.getAttribute("aria-hidden") === "false";
        
        if (isOpen) {
            // Close
            details.style.display = "none";
            details.setAttribute("aria-hidden", "true");
            toggle.setAttribute("aria-expanded", "false");
        } else {
            // Open
            details.style.display = "block";
            details.setAttribute("aria-hidden", "false");
            toggle.setAttribute("aria-expanded", "true");
        }
    });
    
    // Handle keyboard navigation for better accessibility
    toggle.addEventListener("keydown", function(e) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle.click();
        }
    });
})();
