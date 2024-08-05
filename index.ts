import { OpenAI } from "openai";
import puppeteer from 'puppeteer';
import twilio, { Twilio } from 'twilio';
import dotenv from 'dotenv';

// 1. Load environment variables
dotenv.config();

// 2. Define configuration interfaces
interface ProviderConfig {
    apiKey: string;
    baseURL: string;
    model: string;
}

interface TwilioConfig {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
}

interface AppConfig {
    providers: Record<string, ProviderConfig>;
    activeProvider: string;
    twilio: TwilioConfig;
    yourPhoneNumber: string;
}

// 3. Create configuration object
const config: AppConfig = {
    // 4. Define providers
    providers: {
        openai: {
            apiKey: process.env.OPENAI_API_KEY || "",
            baseURL: "https://api.openai.com/v1",
            model: "gpt-4-turbo-preview",
        },
        groq: {
            apiKey: process.env.GROQ_API_KEY || "",
            baseURL: "https://api.groq.com/openai/v1",
            model: "mixtral-8x7b-32768",
        },
        ollama: {
            apiKey: "ollama",
            baseURL: "http://localhost:11434/v1",
            model: "llama2",
        },
    },
    // 5. Set active provider with fallback
    activeProvider: process.env.ACTIVE_PROVIDER || "groq",
    // 6. Twilio configuration
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || "",
        authToken: process.env.TWILIO_AUTH_TOKEN || "",
        phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
    },
    // 7. Your phone number
    yourPhoneNumber: process.env.YOUR_PHONE_NUMBER || "",
};

// 8. Function to initialize OpenAI client
function initializeOpenAI(): OpenAI {
    const provider = config.providers[config.activeProvider];
    if (!provider) {
        throw new Error(`Provider ${config.activeProvider} not found in configuration`);
    }
    return new OpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
    });
}

// 9. Initialize OpenAI client
const openai = initializeOpenAI();

// 10. Twilio service
class TwilioService {
    private client: Twilio;
    private config: TwilioConfig;

    constructor(config: TwilioConfig) {
        this.client = twilio(config.accountSid, config.authToken);
        this.config = config;
    }

    async sendSMS(to: string, message: string): Promise<string> {
        try {
            const result = await this.client.messages.create({
                body: message,
                from: this.config.phoneNumber,
                to: to
            });
            return `SMS sent successfully. SID: ${result.sid}`;
        } catch (error) {
            console.error("Error sending SMS:", error);
            return "Failed to send SMS";
        }
    }
}

const twilioService = new TwilioService(config.twilio);

// 11. Function to scrape Hacker News
async function getHackerNews(): Promise<Array<{ title: string; link: string; score: string }>> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('https://news.ycombinator.com/', { waitUntil: 'networkidle0' });

        const topStories = await page.evaluate(() => {
            const stories = document.querySelectorAll('.athing');
            return Array.from(stories, story => {
                const titleElement = story.querySelector('.titleline > a');
                const scoreElement = story.nextElementSibling?.querySelector('.score');

                return {
                    title: titleElement?.textContent ?? '',
                    link: titleElement?.getAttribute('href') ?? '',
                    score: scoreElement?.textContent ?? ''
                };
            });
        });

        return topStories;
    } catch (error) {
        console.error("Error scraping Hacker News:", error);
        return [];
    } finally {
        await browser.close();
    }
}

// 12. Main function to run the news app
async function runNewsApp(): Promise<void> {
    console.log("Starting news app run");
    try {
        const hackerNewsData = await getHackerNews();
        const prompt = `
            Analyze the following Hacker News data:
            
            ${JSON.stringify(hackerNewsData, null, 2)}
            
            Scan for stories specifically related to AI, machine learning, or software engineering. Include up to 3 relevant items.
            If found, create a brief, friendly message starting with "hey, check this out..." and include a link to news.ycombinator.com.
            For each item:
            1. Include the title (keep it lowercase)
            2. Provide a clickable link to the story
            3. Mention the score
            4. Add a brief (1-2 sentence) summary of why it's relevant to AI or software engineering
            
            Keep the tone casual, as if texting a friend.
            
            If there are no relevant AI or software engineering items, respond with exactly "no ai or dev updates right now!"
        `;
        console.log("Sending prompt to OpenAI");
        const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: config.providers[config.activeProvider].model,
        });

        const message = completion.choices[0]?.message?.content?.trim() ?? "";
        console.log(message)
        if (message.length > 50 && message !== "no ai or dev updates right now!") {
            console.log("Relevant news found, sending SMS");
            const smsResult = await twilioService.sendSMS(config.yourPhoneNumber, message);
            console.log(smsResult);
        } else {
            console.log("No relevant news found or short message, SMS not sent");
        }

    } catch (error) {
        console.error("Error in runNewsApp:", error);
    }
}

// 13. Set up interval to run app every 3 hours
setInterval(runNewsApp, 3 * 60 * 60 * 1000);

// 14. Initial run of the app
console.log("Initiating first run of the app");
runNewsApp();