// Presentation-layer date formatting for the masthead and article datelines.
// Deliberately Intl-free and branch-free: workerd's ICU footprint varies, and
// the 100% branch-coverage gate over src/** punishes incidental conditionals,
// so we index fixed name tables and read UTC fields directly.

const WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
];

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

// Masthead dateline, newspaper-style: "Saturday, June 13, 2026".
export function longDate(date: Date): string {
	const weekday = WEEKDAYS[date.getUTCDay()];
	const month = MONTHS[date.getUTCMonth()];
	return `${weekday}, ${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// Compact article dateline: "Jun 13, 2026".
export function shortDate(seconds: number): string {
	const date = new Date(seconds * 1000);
	const month = MONTHS[date.getUTCMonth()].slice(0, 3);
	return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// Machine-readable timestamp for the <time datetime> attribute.
export function isoTime(seconds: number): string {
	return new Date(seconds * 1000).toISOString();
}
