import type { Metadata } from "next";
import { ContentPage, Part } from "@/components/shell/ContentPage";
export const metadata: Metadata = {
  title: "Methods",
  description: "How studies select variables, fit trends and report statistical evidence.",
};
export default function MethodsPage() {
  return (
    <ContentPage
      title="Research methods"
      lede="Each study records the plan, data versions and comparison families behind its results."
    >
      <Part id="selection" title="Phenomenon and region">
        <p>
          The phenomenon description selects relevant physical variables and registered indicators from the
          offline catalogue. The selection records each variable’s role, scientific source and reason for
          inclusion. The region and months come from the structured controls. A preset can supply either
          missing condition.
        </p>
      </Part>
      <Part id="sources" title="Products and coverage">
        <p>
          Each variable uses a single approved product across the study period. Its record identifies the
          product, any fallback decision and the months with valid observations. Variables with insufficient
          coverage stay visible with an explanation.
        </p>
      </Part>
      <Part id="trends" title="Seasonal patterns and trends">
        <p>
          For monthly series, the registered historical reference supplies a mean for each calendar month.
          Subtracting that mean gives an anomaly. A linear fit to the anomalies estimates the change per year
          and per decade over the analysis period. Each result includes its original history, fixed seasonal
          pattern, actual sample support and available fitted values.
        </p>
        <p>
          The trend record identifies the inference method, calendar lag and diagnostics. A descriptive rate
          may still be available when sample length, coverage or other diagnostics prevent inference.
        </p>
      </Part>
      <Part id="evidence" title="Statistical evidence">
        <p>
          The study reports raw p-values and values adjusted for the comparisons actually tested. The primary
          significance label uses the applicable adjusted result. A preset preserves the broader family of
          comparisons used to select it. Each 95% pointwise interval applies to its individual slope.
        </p>
      </Part>
      <Part id="indicators" title="Indicators and recorded events">
        <p>
          Derived indicators use registered scientific definitions, input products, calibration periods and
          event rules. Recorded-event trends require a prepared catalogue with documented time coverage.
          Missing records appear as a data requirement. A count of zero requires complete coverage.
        </p>
      </Part>
      <Part id="history" title="Changing the period">
        <p>
          Applying a chart range starts a new study. The fixed historical reference stays attached to its
          dataset version while the analysis window, valid samples, trends and comparison family are evaluated
          again. JSON and CSV downloads come from the same completed study.
        </p>
      </Part>
    </ContentPage>
  );
}
