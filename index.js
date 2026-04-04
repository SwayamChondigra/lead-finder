const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/search', async (req, res) => {
const { query } = req.body;

if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
}

let browser;

try {
    browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage'
  ]
});

    const page = await browser.newPage();

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for results
    await page.waitForSelector('a[href*="/maps/place/"]', { timeout: 15000 });

    // Scroll for more results
    for (let i = 0; i < 10; i++) {
        await page.evaluate(() => {
            const feed = document.querySelector('[role="feed"]');
            if (feed) feed.scrollBy(0, 1000);
        });
        await new Promise(r => setTimeout(r, 1000));
    }

    const items = await page.$$eval('a[href*="/maps/place/"]', els =>
        els.map(el => ({
            name: el.getAttribute('aria-label') || 'Unknown',
            link: el.href,
            parentText: el.closest('[role="article"]')?.innerText || ''
        }))
    );

    // Remove duplicates
    const rawLeads = [];
    for (const item of items) {
        if (item.name !== 'Unknown' && !rawLeads.find(l => l.name === item.name)) {
            rawLeads.push(item);
        }
    }

    const maxItems = Math.min(rawLeads.length, 15);
    const data = [];

    for (let i = 0; i < maxItems; i++) {
        const lead = rawLeads[i];

        try {
            const detailPage = await browser.newPage();

            await detailPage.goto(lead.link, {
                waitUntil: 'domcontentloaded',
                timeout: 20000
            });

            await detailPage.waitForSelector('h1', { timeout: 5000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));

            const leadInfo = await detailPage.evaluate(() => {
                let phone = 'Not Available';

                const phoneEl = document.querySelector('button[data-item-id*="phone"]');
                if (phoneEl) {
                    phone = phoneEl.innerText;
                }

                const websiteBtn = document.querySelector('a[data-item-id="authority"]');

                let website = false;

                if (
                    websiteBtn &&
                    websiteBtn.href &&
                    websiteBtn.href.startsWith('http') &&
                    !websiteBtn.href.includes('google.com')
                ) {
                    website = true;
                }

                return { phone, website };
            });

            await detailPage.close();

            // Extract rating
            let rating = 'N/A';
            const match = lead.parentText.match(/(\d\.\d)/);
            if (match) rating = match[1];

            // WhatsApp link
            const whatsapp = leadInfo.phone !== 'Not Available'
                ? `https://wa.me/91${leadInfo.phone.replace(/\D/g, '')}`
                : null;

            data.push({
                name: lead.name,
                rating,
                phone: leadInfo.phone,
                website: leadInfo.website,
                priority: !leadInfo.website,
                whatsapp,
                link: lead.link
            });

        } catch (err) {
            console.log('Error extracting item', i, err.message);
        }
    }

    // Sort: priority first, then rating
    data.sort((a, b) => {
        if (a.priority === b.priority) {
            return parseFloat(b.rating || 0) - parseFloat(a.rating || 0);
        }
        return b.priority - a.priority;
    });

    await browser.close();

    return res.json(data);

} catch (error) {
    if (browser) await browser.close();
    console.error('Scraping Error:', error.message);
    return res.status(500).json({ error: 'Scraping failed' });
}

});

app.post('/message', (req, res) => {
const { category, name } = req.body;

const message = `Hi ${name}, I found your business on Google Maps.
I help local ${category}s get more customers by building modern websites.
I even created a demo idea for businesses like yours.
Would you like to see it?`;

res.json({ message });
});

app.post('/export', (req, res) => {
const { leads } = req.body;


let csv = 'Name,Rating,Phone,Website,Link,Message\n';

leads.forEach(l => {
    const clean = (val) => {
        if (!val) return '';
        return String(val)
            .replace(/"/g, '""')     // escape quotes
            .replace(/\n/g, ' ')     // remove line breaks
            .replace(/\r/g, ' ');
    };

    const name = clean(l.name);
    const rating = clean(l.rating);
    const phone = l.phone ? `="${l.phone}"` : '';
    const website = l.website ? 'Yes' : 'No';
    const link = clean(l.link);
    const message = clean(l.message);
    const whatsapp = l.whatsapp || '';

    csv += `"${name}","${rating}","${phone}","${website}","${link}","${message}","${whatsapp}"\n`;
});

const filename = `leads-${Date.now()}.csv`;
const filepath = path.join(__dirname, 'public', filename);

fs.writeFileSync(filepath, csv);

res.json({ fileUrl: `http://localhost:${PORT}/${filename}` });

});

app.listen(PORT, () => {
console.log(`Server running at http://localhost:${PORT}`);
});
