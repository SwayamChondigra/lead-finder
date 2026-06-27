const BASE_URL = "";

const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const categorySelect = document.getElementById("categorySelect");
const resultsContainer = document.getElementById("resultsContainer");
const exportBtn = document.getElementById("exportBtn");
const loader = document.getElementById("loader");
const toast = document.getElementById("toast");
const emptyState = document.getElementById("emptyState");

let currentLeads = [];

// Escape utility function to prevent XSS and malformed HTML
function escapeHTML(str, forAttribute = false) {
  if (!str) return "";
  const temp = document.createElement("div");
  temp.textContent = str;
  let result = temp.innerHTML;
  if (forAttribute) {
    result = result.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  return result;
}

function showToast() {
  toast.classList.remove("hidden", "fade-out");
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2000);
}

async function searchLeads() {
  const query = searchInput.value.trim();
  if (!query) {
    alert("Please enter a search query!");
    return;
  }

  // Update UI State for Loading
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching...";
  loader.classList.remove("hidden");
  resultsContainer.innerHTML = "";
  emptyState.classList.add("hidden");

  try {
    // Fetch Leads from Backend Express Server
    const res = await fetch(`${BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const leads = await res.json();

    if (!leads || leads.length === 0) {
      emptyState.classList.remove("hidden");
      resultsContainer.innerHTML = "";
      exportBtn.classList.add("hidden");
      return;
    }

    currentLeads = leads;
    emptyState.classList.add("hidden");
    exportBtn.classList.remove("hidden");

    const category = categorySelect.value;

    const statsBar = document.getElementById("statsBar");

    const total = leads.length;
    const highPriority = total;

    statsBar.innerHTML = `
📊 Total: <strong>${total}</strong> 
• 🔴 Priority: <strong style="color:red;">${highPriority}</strong>
`;

    // Generate customized message for each lead and render card
    await Promise.all(leads.map((lead) => createLeadCard(lead, category)));
  } catch (error) {
    console.error("API Error:", error);
    alert(
      "An error occurred while fetching leads. Please check if the backend is running.",
    );
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Search Leads";
    loader.classList.add("hidden");
  }
}

async function createLeadCard(lead, category) {
  try {
    const msgRes = await fetch(`${BASE_URL}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, name: lead.name }),
    });

    if (!msgRes.ok) {
      throw new Error("Message endpoint failed");
    }

    const data = await msgRes.json();
    const message = data.message || "No message generated";

    // Mutate original lead object to store message for future CSV export
    lead.message = message;

    // Creates a new card element and appends it to the container
    const card = document.createElement("div");
    card.className = "lead-card";
    if (lead.priority) {
      card.style.border = "2px solid red";
    }

    // Add staggered animation delay
    const currentCount = document.querySelectorAll(".lead-card").length;
    card.style.animationDelay = `${currentCount * 0.1}s`;

    // Format Web Text securely based on bool logic
    let webText;

    if (lead.website) {
      webText = `
        <a href="${lead.website}" target="_blank" style="color:var(--success-color); text-decoration:underline;">
            🌐 ${lead.domain || "Visit Website"}
        </a>
    `;
    } else {
      webText =
        '<span style="color:red; font-weight:bold;">❌ No Website (High Priority)</span>';
    }
    const whatsappLink =
      lead.phone !== "Not Available"
        ? `https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`
        : null;
    card.innerHTML = `
            <div class="card-header">
                <div class="card-title">${escapeHTML(lead.name)}</div>
                <div class="card-rating">⭐ ${escapeHTML(lead.rating)}</div>
                <div class="card-rating">
🔥 Score: ${lead.leadScore}
</div>
            </div>
            <div style="font-size: 0.9rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 0.35rem;">
                ${
                  lead.phone !== "Not Available"
                    ? `<div><strong>Phone:</strong> <span style="color:var(--text-primary)">${escapeHTML(lead.phone)}</span></div>`
                    : ""
                }</div>
                <div>
  <strong>Reviews:</strong>
  ${lead.reviews}
</div>
                <div><strong>Website:</strong> ${webText}</div>
            </div>
            <div class="card-message">${escapeHTML(message)}</div>
            <div class="card-actions">

    <button class="btn-primary copy-btn" data-msg="${escapeHTML(message, true)}">
        Copy Msg
    </button>

   ${
     whatsappLink
       ? `<a href="${whatsappLink}" target="_blank">
        <button class="btn-success">WhatsApp</button>
      </a>`
       : ""
   }

    <a href="${escapeHTML(lead.link)}" target="_blank">
        <button class="btn-secondary">Open Maps</button>
    </a>

</div>
        `;

    // Setting up the clipboard event for the copy button
    const copyBtn = card.querySelector(".copy-btn");
    copyBtn.addEventListener("click", () => {
      const textToCopy = copyBtn.getAttribute("data-msg");
      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          showToast();
        })
        .catch((e) => {
          console.error("Clipboard API failed: ", e);
          alert("Failed to copy. Please manually copy the message.");
        });
    });

    resultsContainer.appendChild(card);
  } catch (err) {
    console.error("Error generating message for lead:", lead.name, err);
  }
}

// Event Listeners
searchBtn.addEventListener("click", searchLeads);

searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    searchLeads();
  }
});

exportBtn.addEventListener("click", async () => {
  if (currentLeads.length === 0) return;

  exportBtn.disabled = true;
  exportBtn.textContent = "Exporting...";

  try {
    const res = await fetch(`${BASE_URL}/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ leads: currentLeads }),
    });

    if (!res.ok) throw new Error("Export failed");

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();

    exportBtn.textContent = "Exported ✓";
    setTimeout(() => {
      exportBtn.textContent = "Export CSV";
      exportBtn.disabled = false;
    }, 2000);
  } catch (e) {
    console.error(e);
    alert("Failed to export CSV");
    exportBtn.disabled = false;
    exportBtn.textContent = "Export CSV";
  }
});
