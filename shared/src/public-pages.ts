/**
 * Public, crawlable pages. The same content drives the browser routes and the
 * server-rendered shell so crawlers that do not run JavaScript see the real
 * document instead of the homepage.
 */

export interface PublicPageSection {
  heading: string;
  paragraphs: string[];
}

export interface PublicPage {
  /** Canonical path, always starting with a slash. */
  path: string;
  /** Full document title. */
  title: string;
  /** Meta description for the initial HTML response. */
  description: string;
  /** Short label for footer navigation. */
  navLabel: string;
  /** Page heading, rendered as the h1. */
  heading: string;
  /** Opening paragraphs, shown before the first section. */
  intro: string[];
  sections: PublicPageSection[];
}

export const SITE = {
  name: "OnlyKas",
  title: "OnlyKas — Get paid directly by your fans and keep 99%",
  description:
    "OnlyKas lets creators publish paid photos and videos, set their own price, and get paid directly by fans on Kaspa. You keep 99%.",
} as const;

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: "/content-policy",
    title: "Content policy — OnlyKas",
    description:
      "What creators may publish on OnlyKas, including the rules for adult material and AI-generated content.",
    navLabel: "Content policy",
    heading: "Content policy",
    intro: [
      "OnlyKas is for adult creators and their fans. You must be at least 18 years old to publish or unlock content. This policy explains what is allowed, what is not, and how we enforce it.",
    ],
    sections: [
      {
        heading: "What you may publish",
        paragraphs: [
          "Legal, consensual adult content that you own or have permission to publish.",
          "AI-generated and synthetic media, as long as it is clearly labeled, does not depict a real, identifiable person without that person's consent, and does not fall into a prohibited category below.",
          "Photos and videos that respect the privacy and rights of everyone shown.",
        ],
      },
      {
        heading: "What is not allowed",
        paragraphs: [
          "Any content involving minors, or that sexualizes minors in any way.",
          "Non-consensual content, including hidden-camera material, leaked or stolen media, and intimate images shared without consent.",
          "Deepfakes or synthetic likenesses of real people created without their consent.",
          "Content that depicts sexual violence, coercion, bestiality, incest, or extreme violence.",
          "Content you do not have the rights to publish, or that infringes someone else's copyright or trademarks.",
          "Content that promotes illegal goods or services, or that is otherwise unlawful in the places OnlyKas operates.",
        ],
      },
      {
        heading: "Labeling AI-generated content",
        paragraphs: [
          "If a photo or video is generated or significantly altered with AI, say so in the caption. Labels protect fans and keep synthetic media from being mistaken for real events or real people.",
        ],
      },
      {
        heading: "Reporting and enforcement",
        paragraphs: [
          "Anyone can report content that breaks these rules. We review reports and may remove content, restrict publishing, or close an account.",
          "We report illegal content, including child sexual abuse material, to the relevant authorities.",
          "Because publishing on OnlyKas is permanent on-chain, removing a listing does not remove the underlying media from the internet. Do not publish anything you may later need to take back.",
        ],
      },
    ],
  },
  {
    path: "/terms",
    title: "Terms of service — OnlyKas",
    description:
      "The terms for publishing and unlocking paid content on OnlyKas, including the 1% platform fee and direct Kaspa payments.",
    navLabel: "Terms",
    heading: "Terms of service",
    intro: [
      "These terms govern your use of OnlyKas. By connecting a wallet, publishing content, or unlocking content, you agree to them. If you do not agree, do not use OnlyKas.",
    ],
    sections: [
      {
        heading: "Eligibility",
        paragraphs: [
          "You must be at least 18 years old and legally able to enter into these terms. You are responsible for your wallet, its keys, and everything done through it.",
        ],
      },
      {
        heading: "Fees and payments",
        paragraphs: [
          "OnlyKas charges a 1% platform fee on paid unlocks and memberships. Creators keep the other 99%.",
          "Payments are made directly from fans to creators in Kaspa (KAS). OnlyKas never holds your funds and cannot reverse, refund, or block a payment.",
          "Kaspa network fees are set by the network, not by OnlyKas, and are paid by the person sending the transaction.",
          "Subscription and unlock prices are set by each creator. All payments are final.",
        ],
      },
      {
        heading: "Publishing",
        paragraphs: [
          "Publishing is permanent. Once content and its price are published, they cannot be edited or withdrawn from the chain.",
          "You keep ownership of your content. You grant OnlyKas permission to store and serve it so fans can view what they have unlocked.",
          "You are responsible for making sure you have the rights to everything you publish and that it follows our content policy.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "Do not use OnlyKas to break the law, infringe rights, publish prohibited content, or interfere with the service or other people's use of it.",
          "We may remove listings, restrict access, or close accounts that break these terms.",
        ],
      },
      {
        heading: "Disclaimers and liability",
        paragraphs: [
          "OnlyKas is provided as is, without warranties of any kind. We do not guarantee that the service will be uninterrupted, secure, or free of errors.",
          "To the fullest extent allowed by law, OnlyKas is not liable for indirect, incidental, or consequential losses, or for losses resulting from blockchain transactions that cannot be reversed.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "We may update these terms. When we do, we will change the date below. Continuing to use OnlyKas after a change means you accept the new terms.",
        ],
      },
    ],
  },
  {
    path: "/privacy",
    title: "Privacy policy — OnlyKas",
    description:
      "What data OnlyKas collects, how it is used, and the choices you have. No email addresses or passwords, and payments stay in your wallet.",
    navLabel: "Privacy",
    heading: "Privacy policy",
    intro: [
      "OnlyKas is built around a wallet, not an email and password. This policy explains what we collect, why, and what you can do about it.",
    ],
    sections: [
      {
        heading: "What we collect",
        paragraphs: [
          "Your Kaspa wallet address, which identifies your account.",
          "Any display name you choose, and whether your creator page is public.",
          "The content you publish, its price, and when it was published.",
          "Feedback you send us, and basic technical logs such as request times and errors.",
        ],
      },
      {
        heading: "What we do not collect",
        paragraphs: [
          "We do not ask for your email address, password, or government identity documents.",
          "We never hold your funds and we never have access to your wallet's private keys or seed phrase.",
        ],
      },
      {
        heading: "Payments and public data",
        paragraphs: [
          "Payments happen on the Kaspa blockchain. Transaction amounts and addresses are public by nature and can be seen by anyone. OnlyKas cannot make an on-chain payment private.",
        ],
      },
      {
        heading: "Cookies",
        paragraphs: [
          "We use a single session cookie to keep you signed in. It is required for the service to work and is not used for advertising.",
        ],
      },
      {
        heading: "Service providers",
        paragraphs: [
          "We share only what is necessary with providers that host the site, store media, and connect to the Kaspa network. We do not sell your data or use it for advertising.",
        ],
      },
      {
        heading: "Your choices",
        paragraphs: [
          "You can disconnect your wallet at any time, set your creator page to private, or ask us to delete your profile details.",
          "Content published on-chain cannot be deleted from the blockchain, even if we stop serving it.",
        ],
      },
    ],
  },
];

export function publicPageByPath(path: string): PublicPage | undefined {
  return PUBLIC_PAGES.find((page) => page.path === path);
}
