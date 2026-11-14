"use client";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function MonthField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [year = "", month = ""] = value.split("-");
  function edit(nextYear: string, nextMonth: string) {
    onChange(nextYear || nextMonth ? `${nextYear}-${nextMonth}` : "");
  }

  return (
    <fieldset className="month-field">
      <legend>{label} month</legend>
      <div className="month-parts">
        <select aria-label={label + " month"} value={month} onChange={(e) => edit(year, e.target.value)}>
          <option value="">Month</option>
          {monthNames.map((name, index) => (
            <option key={name} value={String(index + 1).padStart(2, "0")}>
              {name}
            </option>
          ))}
        </select>
        <input
          aria-label={label + " year"}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY"
          title="Four-digit year, 0001 to 9999"
          maxLength={4}
          pattern="[0-9]{4}"
          value={year}
          onChange={(e) => {
            if (/^[0-9]{0,4}$/.test(e.target.value)) edit(e.target.value, month);
          }}
        />
      </div>
    </fieldset>
  );
}
