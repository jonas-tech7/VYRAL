import type { Metadata } from "next";
import { Field, LegalDoc, legalOperator } from "@/components/legal/legal";

export const metadata: Metadata = { title: "Imprint", description: "Legal notice (Impressum) for VYRAL." };

export default function ImprintPage() {
  const op = legalOperator();
  return (
    <LegalDoc title="Imprint (Impressum)">
      <h2 id="provider">Service provider</h2>
      <p>
        <Field value={op.name} label="Name or company name, incl. legal form" />
        <br />
        {op.addressLines.length ? (
          op.addressLines.map((l) => (
            <span key={l}>
              {l}
              <br />
            </span>
          ))
        ) : (
          <Field value={null} label="Street and number | Postcode and city | Country" />
        )}
      </p>
      {op.representative ? (
        <p>
          Represented by: <Field value={op.representative} label="managing director" />
        </p>
      ) : null}

      <h2 id="contact">Contact</h2>
      <p>
        Email: <Field value={op.email} label="contact email" />
        <br />
        Phone: <Field value={op.phone} label="phone number" />
      </p>

      {op.register || op.vatId ? (
        <>
          <h2 id="register">Register and tax</h2>
          <p>
            {op.register ? (
              <>
                Register entry: {op.register}
                <br />
              </>
            ) : null}
            {op.vatId ? <>VAT ID: {op.vatId}</> : null}
          </p>
        </>
      ) : null}

      <h2 id="responsible">Responsible for content</h2>
      <p>
        <Field value={op.representative ?? op.name} label="Name" />, address as above.
      </p>

      <h2 id="dispute">Consumer dispute resolution</h2>
      <p>
        <Field value={null} label="Statement under § 36 VSBG, e.g. We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board." />
      </p>
    </LegalDoc>
  );
}
