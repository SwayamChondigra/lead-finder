require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const Groq = require("groq-sdk");

// ✅ Fix fetch for Node
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ================= SEARCH =================
app.post("/search", async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
        query,
      )}&key=${process.env.API_KEY}`,
    );

    const searchData = await searchRes.json();

    console.log("Google API Response:", searchData.status);

    if (searchData.error_message) {
      console.log(searchData.error_message);
    }

    let allResults = [...searchData.results];

    // 👉 GET MORE RESULTS USING NEXT PAGE
    if (searchData.next_page_token) {
      await new Promise((r) => setTimeout(r, 2000)); // required delay

      const nextRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${searchData.next_page_token}&key=${process.env.API_KEY}`,
      );

      const nextData = await nextRes.json();

      if (nextData.results) {
        allResults = allResults.concat(nextData.results);
      }
    }

    const results = await Promise.all(
      allResults
        .sort(() => Math.random() - 0.5)
        .slice(0, 20)
        .map(async (place) => {
          let website = null;
          let domain = null;
          let phone = "Not Available";

          if (place.place_id) {
            try {
              const detailsRes = await fetch(
                `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,website,formatted_phone_number&key=${process.env.API_KEY}`,
              );

              const detailsData = await detailsRes.json();

              if (detailsData.result) {
                if (detailsData.result.website) {
                  try {
                    const url = new URL(detailsData.result.website);
                    const hostname = url.hostname.replace("www.", "");

                    // ❌ BLOCK THESE FAKE "WEBSITES"
                    const blockedDomains = [
                      "instagram.com",
                      "facebook.com",
                      "swiggy.com",
                      "zomato.com",
                      "justdial.com",
                      "google.com",
                      "business.site",
                    ];

                    const isFake = blockedDomains.some((d) =>
                      hostname.includes(d),
                    );

                    if (!isFake) {
                      website = detailsData.result.website;
                      domain = hostname;
                    }
                  } catch {}
                }

                if (detailsData.result.formatted_phone_number) {
                  phone = detailsData.result.formatted_phone_number;
                }
              }
            } catch (err) {
              console.log("Details fetch error:", err);
            }
          }

          return {
            name: place.name,
            rating: place.rating || 0,
            reviews: place.user_ratings_total || 0,
            address: place.formatted_address,
            link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`,
            phone,
            website,
            domain,
            priority: !website,
            leadScore:
              (!website ? 50 : 0) +
              (place.rating || 0) * 10 +
              Math.min(place.user_ratings_total || 0, 100),
          };
        }),
    );

    const filtered = results
      .filter((r) => !r.website)
      .sort((a, b) => b.leadScore - a.leadScore);

    res.json(filtered);
  } catch (err) {
    console.log("Search Error:", err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// ================= MESSAGE =================
app.post("/message", async (req, res) => {
  try {
    const { category, name, rating, reviews, leadScore, website } = req.body;

    const prompt = `
You are an expert sales copywriter.

Generate a friendly WhatsApp outreach message.

Business Details:
- Business Name: ${name}
- Category: ${category}
- Rating: ${rating}
- Reviews: ${reviews}
- Lead Score: ${leadScore}
- Has Website: ${website ? "Yes" : "No"}

Rules:
- Address the owner by the business name.
- Mention the rating naturally.
- If there is no website, explain why having one can help.
- Mention benefits specific to the business category.
- Keep it under 120 words.
- Make it sound natural and human.
- Do NOT use markdown.
- End with:
"Would you like to see a demo website I designed for businesses like yours?"
`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.8,
    });

    res.json({
      message: completion.choices[0].message.content,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Failed to generate AI message.",
    });
  }
});

// ================= EXPORT =================
app.post("/export", (req, res) => {
  const { leads } = req.body;

  let csv = "Name,Rating,Phone,Website,Link\n";

  const clean = (val) => {
    if (!val) return "";
    return String(val)
      .replace(/"/g, '""')
      .replace(/\n/g, " ")
      .replace(/\r/g, " ");
  };

  leads.forEach((l) => {
    const name = clean(l.name);
    const rating = clean(l.rating);
    const phone = l.phone ? `="${l.phone}"` : "";
    const website = l.domain || "No Website";
    const link = clean(l.link);

    csv += `"${name}","${rating}","${phone}","${website}","${link}"\n`;
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=leads.csv");

  res.send(csv);
});

// ================= START =================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
