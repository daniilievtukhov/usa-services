const axios = require("axios");
const cheerio = require("cheerio");
const PublicGoogleSheetsParser = require("public-google-sheets-parser");
const spreadsheetId = "1C3wXJoT0UVj1wTeY4Fe8r4N6z2mtptRf";
const parser = new PublicGoogleSheetsParser(spreadsheetId);
const puppeteer = require("puppeteer");
const fs = require("fs");

const BROWSER_CHUNKING = 30; // Number of browsers to open in each iteration

let countSitesWithEmail = 0;
let countTotalEmails = 0;

const sheetIds = [
    619913922, 428550573, 983364835, 479176946, 1948052393, 100181796,
    1263944129, 470463245, 1784285009, 1938948094, 177740608, 260320561,
];

function writeToJsonFile(data, filename) {
    fs.writeFileSync(filename + ".json", JSON.stringify(data, null, 2));
    console.log(`Data successfully written to the file ${filename}`);
}

function cleanAndLowerCase(infoArr) {
    return [
        ...new Set(
            infoArr.map((item) =>
                item
                    .replace(/[\n\t\r\s]/g, "")
                    .trim()
                    .toLowerCase()
            )
        ),
    ];
}

function fixFacebookUrl(url) {
    const startIndex = url.indexOf("facebook.com/");
    if (startIndex !== -1) {
        return "https://" + url.substring(startIndex);
    } else {
        return url;
    }
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

async function getEmailFromFacebook(url) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.setViewport({ width: 1080, height: 1024 });

    await page.waitForFunction(() => {
        const elements = document.querySelectorAll("span, a");
        return [...elements].some(
            (element) => element.textContent.trim() !== ""
        );
    });

    const items = await page.evaluate(() => {
        const elements = [...document.querySelectorAll("span, a")];
        return elements.map((element) => element.textContent);
    });

    await browser.close();

    return items.find((spanText) => isValidEmail(spanText));
}

async function scrapeEmails(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const emails = [];
        $("span, a").each((index, element) => {
            const text = $(element).text().trim();
            const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
            const matches = text.match(emailRegex);
            if (matches) {
                emails.push(...matches);
            }
        });

        return cleanAndLowerCase(emails);
    } catch (error) {
        console.error("Error scraping emails:", error);
    }
}

async function scrapePhoneNumbers(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const phoneNumbers = [];
        const phoneRegex = /(\+1)?\s?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}/g;
        $("body").each((index, element) => {
            const text = $(element).text().trim();
            const matches = text.match(phoneRegex);
            if (matches) {
                phoneNumbers.push(...matches);
            }
        });

        return cleanAndLowerCase(phoneNumbers);
    } catch (error) {
        console.error("Error scraping phone numbers:", error);
    }
}

async function scrapeSocialMediaLinks(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const socialMediaLinks = [];
        const socialMedias = [
            "facebook",
            "google",
            "instagram",
            "yelp",
            "twitter",
            "tiktok",
            "youtube",
            "skype",
            "linkedin",
        ];
        $("a[href]").each((index, element) => {
            const link = $(element).attr("href");
            if (
                socialMedias.some((media) => link.toLowerCase().includes(media))
            ) {
                socialMediaLinks.push(link);
            }
        });

        return cleanAndLowerCase(socialMediaLinks);
    } catch (error) {
        console.error("Error scraping social media links:", error);
    }
}

async function fetchSiteData(url) {
    try {
        let [emails, phoneNumbers, socialMediaLinks] = await Promise.all([
            scrapeEmails(url),
            scrapePhoneNumbers(url),
            scrapeSocialMediaLinks(url),
        ]);

        const facebookPage = socialMediaLinks.find((socialMedia) =>
            socialMedia.includes("facebook")
        );

        if (facebookPage) {
            const facebookEmail = await getEmailFromFacebook(
                fixFacebookUrl(facebookPage)
            );
            facebookEmail ? emails.push(facebookEmail) : null;
        }

        const validEmails = cleanAndLowerCase(emails);

        if (validEmails.length) {
            countSitesWithEmail++;
            countTotalEmails += validEmails.length;
        }

        return {
            emails: validEmails,
            phoneNumbers: phoneNumbers,
            socialMediaLinks: socialMediaLinks,
        };
    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

const finalSitesInfo = [];

async function processSheet(sheetId) {
    try {
        const items = await parser.parse(spreadsheetId, { sheetId });

        const countSubstringOccurrences = (keyword, domain) => {
            let maxSub = 0;
            let count = 0;
            let result = 0;
            const wordsInLowerCase = keyword.toLowerCase().split(/\s+/);

            for (let word of wordsInLowerCase) {
                for (let i = 0; i < domain.length; i++) {
                    for (let j = 0; j < word.length; j++) {
                        if (domain[j + i] === word[j]) {
                            count++;
                        }
                    }
                    maxSub = Math.max(count, maxSub);
                    count = 0;
                }
                result += maxSub;
                maxSub = 0;
            }

            return result;
        };

        const websiteFilter = (websiteObj) => {
            if (!websiteObj.website) return "";

            if (
                websiteObj.website.includes("facebook.com") ||
                websiteObj.website.includes("business.site")
            ) {
                return website.replace(/\bfacebook\.com\b(?=,|$)/g, "").trim();
            }

            if (websiteObj.website.split(/\s+/).length > 1) {
                const links = websiteObj.website.split(" ");
                if (links[0] === links[1]) {
                    return websiteObj.website.replace(/,.*$/, "");
                } else {
                    const [domain1, domain2] = links.map((link) =>
                        link.toLowerCase().replace(/-/g, "").replace(/\/.*/, "")
                    );
                    const companyNameAndKeyword =
                        websiteObj.name.toLowerCase().replace(/-/g, "") +
                        websiteObj.keyword;

                    return countSubstringOccurrences(
                        companyNameAndKeyword,
                        domain1
                    ) >
                        countSubstringOccurrences(
                            companyNameAndKeyword,
                            domain2
                        )
                        ? { ...websiteObj, website: links[0] }
                        : { ...websiteObj, website: links[1] };
                }
            }

            return websiteObj;
        };

        const infoWithCorrectWebsites = items.map(websiteFilter);

        infoWithCorrectWebsites.forEach((item) => delete item.phone);

        function chunkArray(array, chunkSize) {
            const chunkedArray = [];
            for (let i = 0; i < array.length; i += chunkSize) {
                chunkedArray.push(array.slice(i, i + chunkSize));
            }
            return chunkedArray;
        }

        const chunkedWebsites = chunkArray(
            infoWithCorrectWebsites,
            BROWSER_CHUNKING
        );

        const result = [];

        for (let chunk of chunkedWebsites) {
            const websitesInfoPromises = chunk.map(async (chunkObj) => {
                const siteInfo = await fetchSiteData(
                    `https://${chunkObj.website}/`
                );
                return { ...chunkObj, ...siteInfo };
            });

            const websitesInfo = await Promise.all(websitesInfoPromises);
            result.push(...websitesInfo);
        }

        finalSitesInfo.push(...result);
    } catch (error) {
        console.error("Error processing sheet:", error);
    }
}

async function processSheets() {
    for (let sheetId of sheetIds) {
        await processSheet(sheetId);
    }
}

(async () => {
    await processSheets();

    console.log("Final sites information:", finalSitesInfo);

    console.log("Sites with email:", countSitesWithEmail);
    console.log("Total emails:", countTotalEmails);

    writeToJsonFile(finalSitesInfo, "contact-sites-info");
})();
