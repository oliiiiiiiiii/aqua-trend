export async function setMonth(scope, label, value) {
  const [year, month] = value.split("-");
  await scope.getByRole("combobox", { name: label + " month", exact: true }).selectOption(month);
  await scope.getByRole("textbox", { name: label + " year", exact: true }).fill(year);
}

export async function getMonth(scope, label) {
  const year = await scope.getByRole("textbox", { name: label + " year", exact: true }).inputValue();
  const month = await scope.getByRole("combobox", { name: label + " month", exact: true }).inputValue();
  return year + "-" + month;
}
