import { Link, useParams } from "react-router-dom";
import LegalPolicyLinks from "../components/LegalPolicyLinks";
import {
  LEGAL_POLICY_PATHS,
  LEGAL_POLICY_VERSION,
} from "../../shared/legalPolicies.js";

const LEGAL_PAGES = [
  {
    slug: "privacy",
    path: LEGAL_POLICY_PATHS.privacy,
    title: "Privacy Policy",
    summary: "What information the current PartsWalaIND application handles and where owner confirmation is still required.",
    sections: [
      {
        title: "Information handled by the service",
        paragraphs: [
          "Account and sign-in information can include your name, email address, Firebase account identifier, and any phone number you provide or verify.",
          "A vendor application currently asks for business and owner names, email, phone, business address, city, state, PIN code, and optional GSTIN and PAN.",
          "A supplier enquiry contains the product, requested quantity, message, and your account identifier. Your email is shared with the relevant supplier only when you select the separate email-sharing option. The supplier can see the enquiry and its quote response; customers can see their own enquiry and response.",
          "Product reviews, when accepted by the review service, contain a rating and review text. Browser push notifications are optional; enabling them registers a Firebase Cloud Messaging token and stores in-app notification records.",
          "The AI assistant may process the text you submit and the context required for its selected feature through the AI provider configured by the service. Do not enter passwords, payment information, tax identifiers, or other sensitive information into the assistant.",
          "Product and profile images may be sent to the configured Cloudinary service when you use an upload feature. Firebase Authentication, Firestore, Firebase Cloud Messaging, Google sign-in/reCAPTCHA where used, hosting providers, Cloudinary, and configured AI providers may process information to provide the corresponding feature.",
        ],
      },
      {
        title: "Purpose and access",
        paragraphs: [
          "Information is used to authenticate accounts, review vendor applications, operate product listings, receive and answer enquiries, display reviews, provide account features, deliver opted-in notifications, and protect the service.",
          "Access to vendor enquiries is limited by the service to the relevant vendor and buyer. Optional email sharing is a separate choice. Do not assume that a message sent to a supplier is confidential from that supplier.",
        ],
      },
      {
        title: "Storage, deletion, and retention",
        paragraphs: [
          "The application stores account and marketplace records in Firebase services. The browser may also retain Firestore data for offline use, cart contents, recently viewed product details, service-worker cached pages, and authentication state.",
          "The current account deletion action deletes the Firebase Authentication account; it does not itself demonstrate deletion of every associated marketplace, enquiry, notification, vendor, or audit record. Clearing browser storage does not delete server records.",
          "The optional marketing choice on registration is stored separately from required policy acceptance. The reviewed code does not contain a marketing-campaign delivery flow.",
        ],
        ownerConfirm: "Owner confirmation required before publication: retention periods by record type, deletion and correction request workflow, treatment of vendor application tax identifiers and uploaded media, and any legal record-retention exceptions. The current code does not define a complete retention schedule or end-to-end account-data erasure process.",
      },
      {
        title: "Your requests and privacy questions",
        paragraphs: [
          <>Contact <a href="mailto:support@partswalaind.com">support@partswalaind.com</a> for privacy questions or to request review of information associated with your account. Do not email passwords, authentication codes, or payment credentials.</>,
          "Applicable Indian data-protection obligations, including the Digital Personal Data Protection Act, 2023 and rules in force, must be assessed by qualified Indian counsel. This draft does not claim legal compliance or determine which provisions apply.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    path: LEGAL_POLICY_PATHS.terms,
    title: "General Terms & Conditions",
    summary: "Terms for using an enquiry-and-quotation marketplace, subject to business-owner and legal review.",
    sections: [
      {
        title: "Service model",
        paragraphs: [
          "PartsWalaIND currently provides product discovery and supplier enquiry/quotation features. A customer enquiry requests information; it is not an order, accepted offer, reservation, payment, or shipment.",
          "Checkout, online payments, order creation, and shipping are disabled. The website must not be used or described as confirming that any of those functions are available. No such feature becomes enabled automatically at launch.",
        ],
      },
      {
        title: "Listings, enquiries, and quotations",
        paragraphs: [
          "Product information and prices are supplied by the marketplace or vendors and may be incomplete, changed, or unavailable. Confirm fitment, specifications, price, taxes, stock, and any conditions directly with the supplier before making a separate arrangement.",
          "A quotation is a supplier response to an enquiry. The application does not currently convert a quotation into an online order or collect payment for it.",
        ],
      },
      {
        title: "Accounts and acceptable use",
        paragraphs: [
          "Provide accurate account information, protect your sign-in credentials, and use only accounts you are authorized to control. Do not misuse the service, submit unlawful or misleading content, attempt unauthorized access, or interfere with another user's data.",
          "The application may restrict access when authentication, vendor approval, or service availability checks fail. Vendor access is subject to separate approval and the Vendor Terms & Conditions.",
        ],
      },
      {
        title: "Important legal review",
        paragraphs: [
          "This draft is not legal advice and does not create a promise of availability, delivery, warranty, refund, or dispute outcome beyond the features currently implemented.",
        ],
        ownerConfirm: "Owner and qualified Indian legal counsel must confirm the contracting legal entity, applicable governing law and dispute forum, consumer-facing disclosures, liability language, cancellation/refund implications, and effective date before publication.",
      },
    ],
  },
  {
    slug: "vendor-terms",
    path: LEGAL_POLICY_PATHS.vendorTerms,
    title: "Vendor Terms & Conditions",
    summary: "Conditions for vendor applications, approved listings, and supplier quotation workflows.",
    sections: [
      {
        title: "Application and approval",
        paragraphs: [
          "Submitting an application does not grant vendor access. Applications are reviewed, and only accounts that pass the service's approval checks can use protected vendor features.",
          "Provide accurate business and contact details. The application may request a business address and optional GSTIN/PAN. These details are not public product-catalogue fields.",
        ],
      },
      {
        title: "Listings and product images",
        paragraphs: [
          "Submit accurate product names, part numbers, descriptions, prices, stock details, and fitment information. Publish only products you are authorized to offer and images you have the right to use.",
          "The service checks vendor approval and product ownership for protected listing and image operations. Do not attempt to edit another vendor's listings or bypass review/approval controls.",
        ],
      },
      {
        title: "Enquiries and quotations",
        paragraphs: [
          "Respond to enquiries assigned to your approved vendor account. Quote details should be accurate and relevant to the request. A quote is not an order and does not authorize collection of payment through this website.",
          "Buyer email is disclosed to a supplier only when the buyer separately chooses to share it. The current enquiry flow does not provide a buyer's phone number to the vendor.",
          "Checkout, online payments, order creation, and shipping remain disabled, before and after the planned launch, unless separately approved and implemented.",
        ],
      },
      {
        title: "Owner and legal confirmation",
        paragraphs: [
          "The application cannot guarantee listing visibility, buyer response, sales, settlement, or other commercial outcomes.",
        ],
        ownerConfirm: "Owner and qualified Indian legal counsel must approve vendor eligibility, listing/removal procedures, intellectual-property and product compliance terms, tax responsibilities, dispute handling, and any future payment/settlement terms before publication.",
      },
    ],
  },
  {
    slug: "disclaimer",
    path: LEGAL_POLICY_PATHS.disclaimer,
    title: "Disclaimer",
    summary: "Limits of product, fitment, price, AI, and marketplace information.",
    sections: [
      {
        title: "Product and supplier information",
        paragraphs: [
          "Catalogue details, availability, compatibility, images, and prices can be supplied or updated by different marketplace participants. Check important specifications and fitment with the supplier before relying on them.",
          "A displayed listing or supplier quotation is not an online order, payment confirmation, shipment booking, or guarantee that stock is reserved.",
        ],
      },
      {
        title: "Automated assistance",
        paragraphs: [
          "AI-generated responses are informational and may be incomplete or incorrect. Verify technical, compatibility, safety, and commercial information with an appropriate supplier or professional.",
        ],
      },
      {
        title: "No active online commerce",
        paragraphs: [
          "Checkout, online payment, order creation, and shipping are disabled in this release. Launching the public marketplace does not itself enable these functions.",
        ],
        ownerConfirm: "Qualified Indian legal counsel must review this disclaimer alongside the General Terms, Vendor Terms, consumer disclosures, and actual operational practices. Do not rely on this draft to waive rights that cannot lawfully be waived.",
      },
    ],
  },
  {
    slug: "contact",
    path: LEGAL_POLICY_PATHS.contact,
    title: "Contact & Grievance Policy",
    summary: "Use the known public support email; required legal and business contact details remain placeholders for owner confirmation.",
    sections: [
      {
        title: "Customer support",
        paragraphs: [
          <>Email <a href="mailto:support@partswalaind.com">support@partswalaind.com</a> for general support, privacy questions, policy concerns, or to raise a grievance. Include enough information to identify the issue, but do not include passwords, one-time codes, or payment credentials.</>,
          "The code does not establish a published response-time commitment. A response SLA must not be inferred from this page.",
        ],
      },
      {
        title: "Details requiring owner confirmation",
        paragraphs: [
          "Before publication, the business owner must supply and verify the legal entity name, registered office address, and contact details required for the applicable marketplace and consumer disclosures.",
        ],
        ownerConfirm: "OWNER CONFIRMATION REQUIRED — insert the formally appointed grievance officer's name/designation, postal address, email/telephone contact if applicable, and legally reviewed complaint acknowledgement and resolution timelines. No officer or address is identified by this draft.",
      },
    ],
  },
  {
    slug: "cookies",
    path: LEGAL_POLICY_PATHS.cookies,
    title: "Cookie & Browser Storage Policy",
    summary: "The current application uses browser storage and caches; no analytics or advertising-cookie integration was found in the reviewed source.",
    sections: [
      {
        title: "Cookies and similar technologies",
        paragraphs: [
          "The reviewed application source does not directly read or write document cookies and does not include an analytics or advertising SDK. This is a source review, not a guarantee about cookies set by hosting or third-party providers.",
          "Firebase Authentication and sign-in providers, phone verification/reCAPTCHA, and other integrated third-party services may use their own browser storage or cookies as part of their flows. Their behavior is governed in part by those providers.",
        ],
      },
      {
        title: "Storage used by this application",
        paragraphs: [
          "The application stores cart contents and recently viewed product details in localStorage. Firebase Firestore is configured with a persistent IndexedDB cache for offline use. Firebase Authentication uses the SDK's browser persistence. A service worker caches the home, product-list, and sign-in pages for offline fallback; API requests are excluded from that service-worker cache.",
          "If browser push is enabled by the user, the application registers a messaging service worker and stores a Firebase Cloud Messaging token with the user's account. Push permission is requested only after the user chooses to enable notifications.",
        ],
      },
      {
        title: "Your controls",
        paragraphs: [
          "You can clear site data using your browser settings, disable browser notifications in the application or browser, and block third-party storage through browser controls. Clearing local browser data does not delete server-side account or marketplace records.",
        ],
        ownerConfirm: "Owner confirmation required: review hosting/provider cookie behavior on every production domain and approve any future analytics, advertising, consent-management, or non-essential tracking integrations before enabling them.",
      },
    ],
  },
  {
    slug: "enquiries",
    path: LEGAL_POLICY_PATHS.enquiries,
    title: "Enquiry & Quotation Policy",
    summary: "Supplier enquiries and quotes are the current marketplace workflow; they do not create an online transaction.",
    sections: [
      {
        title: "Sending an enquiry",
        paragraphs: [
          "A signed-in customer can send a product enquiry with a requested quantity and message. The enquiry is routed to the approved vendor associated with that eligible product.",
          "Your account identity and enquiry details are available to the relevant supplier so they can respond. Sharing your email address outside the site is optional and requires a separate unchecked-by-default choice on the enquiry form.",
        ],
      },
      {
        title: "Supplier responses",
        paragraphs: [
          "Approved vendors can view enquiries assigned to them and submit or update a quotation for an open enquiry. Customers can view their own enquiries and supplier responses. Access is restricted by the service to the relevant buyer or vendor.",
          "Notifications may be delivered in-app. Browser push is optional and requires your separate action to enable it.",
        ],
      },
      {
        title: "No online purchase",
        paragraphs: [
          "An enquiry or quotation does not create an order, reserve inventory, collect payment, or arrange shipping. Checkout, online payments, order creation, and shipping are disabled before and after launch unless separately approved and implemented.",
        ],
        ownerConfirm: "Owner and qualified Indian legal counsel must review the treatment of quotes, buyer/vendor communications, complaints, and any future transition from enquiry to transaction before publication.",
      },
    ],
  },
];

function OwnerConfirmation({ children }) {
  return <aside className="legal-owner-confirmation"><strong>Draft — owner confirmation required</strong><p>{children}</p></aside>;
}

export default function LegalPolicies() {
  const { slug } = useParams();
  const policy = LEGAL_PAGES.find((item) => item.slug === slug);

  if (!policy) {
    return (
      <main className="legal-page">
        <section className="legal-shell">
          <Link className="legal-back" to="/">PARTSWALA IND</Link>
          <p className="legal-eyebrow">LEGAL &amp; POLICIES</p>
          <h1>Policies</h1>
          <p className="legal-summary">Choose a policy. These drafts require business-owner and qualified Indian legal review before publication.</p>
          <div className="legal-draft-notice" role="note">Draft for owner confirmation and qualified Indian legal review. Policy version {LEGAL_POLICY_VERSION}; this is not legal advice.</div>
          <LegalPolicyLinks />
        </section>
      </main>
    );
  }

  return (
    <main className="legal-page">
      <article className="legal-shell">
        <Link className="legal-back" to="/">← PARTSWALA IND</Link>
        <p className="legal-eyebrow">LEGAL &amp; POLICIES · DRAFT FOR REVIEW</p>
        <h1>{policy.title}</h1>
        <p className="legal-summary">{policy.summary}</p>
        <div className="legal-draft-notice" role="note">
          Draft for owner confirmation and qualified Indian legal review. Version {LEGAL_POLICY_VERSION}; this is not legal advice and is not evidence that a legal compliance review has been completed.
        </div>
        {policy.sections.map((section) => (
          <section className="legal-section" key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            {section.ownerConfirm && <OwnerConfirmation>{section.ownerConfirm}</OwnerConfirmation>}
          </section>
        ))}
        <section className="legal-other-policies">
          <h2>Other policies</h2>
          <LegalPolicyLinks />
        </section>
        <p className="legal-contact-note">Questions: <a href="mailto:support@partswalaind.com">support@partswalaind.com</a></p>
      </article>
    </main>
  );
}
