import { Link } from "react-router-dom";
import { LEGAL_POLICY_PATHS } from "../../shared/legalPolicies.js";

const POLICY_LINKS = [
  ["Privacy Policy", LEGAL_POLICY_PATHS.privacy],
  ["General Terms & Conditions", LEGAL_POLICY_PATHS.terms],
  ["Vendor Terms & Conditions", LEGAL_POLICY_PATHS.vendorTerms],
  ["Disclaimer", LEGAL_POLICY_PATHS.disclaimer],
  ["Contact & Grievance Policy", LEGAL_POLICY_PATHS.contact],
  ["Cookie & Browser Storage Policy", LEGAL_POLICY_PATHS.cookies],
  ["Enquiry & Quotation Policy", LEGAL_POLICY_PATHS.enquiries],
];

export default function LegalPolicyLinks({ className = "" }) {
  return (
    <nav className={`legal-policy-links ${className}`.trim()} aria-label="Legal and policy pages">
      {POLICY_LINKS.map(([label, path]) => <Link key={path} to={path}>{label}</Link>)}
    </nav>
  );
}
