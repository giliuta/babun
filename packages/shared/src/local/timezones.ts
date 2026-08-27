// ЧАСОВЫЕ ПОЯСА — СГРУППИРОВАННЫЕ, А НЕ СПИСОК ГОРОДОВ.
//
// Владелец 2026-08-27: «разбивка не по городам, а по часовым поясам — под
// один часовой пояс отпадает одно и то же». Так и сделано: 59
// строк вместо 418 городов, и на таком числе барабан наконец имеет смысл.
//
// ГРУППИРОВКА НЕ ПО СЕГОДНЯШНЕМУ СМЕЩЕНИЮ. Сегодня Афины и Найроби обе
// «UTC+3», но в последнее воскресенье октября Афины уедут на +2, а Найроби
// нет: свалить их в одну строку — значит на глазах у человека подменить ему
// границу суток через два месяца. Поэтому зоны сведены в группу, только
// если их смещение совпало во ВСЕХ ДВЕНАДЦАТИ месяцах года, то есть они
// переводят часы в одни и те же дни. Из 418 зон вышло 59 групп.
//
// Порядок — по смещению в январе, от запада к востоку: так же читается
// список поясов в ноутбуке и в телефоне.
//
// Сгенерировано из ICU; `zone` — то, что сохраняется в базу, `cities` —
// чем группа подписана и по чему её ищут.
export interface ZoneGroup {
  zone: string;
  cities: string[];
}

export const ZONE_GROUPS: ZoneGroup[] = [
  { zone: "Pacific/Midway", cities: ["Midway", "Niue", "Pago Pago"] },
  { zone: "America/Adak", cities: ["Adak"] },
  { zone: "Pacific/Honolulu", cities: ["Honolulu", "Tahiti", "Rarotonga"] },
  { zone: "Pacific/Marquesas", cities: ["Marquesas"] },
  { zone: "America/Anchorage", cities: ["Anchorage", "Juneau", "Metlakatla", "Nome", "Sitka", "Yakutat"] },
  { zone: "Pacific/Gambier", cities: ["Gambier"] },
  { zone: "America/Los_Angeles", cities: ["Los Angeles", "Tijuana", "Vancouver"] },
  { zone: "Pacific/Pitcairn", cities: ["Pitcairn"] },
  { zone: "America/Denver", cities: ["Denver", "Boise", "Cambridge Bay", "Ciudad Juarez", "Edmonton", "Inuvik"] },
  { zone: "America/Phoenix", cities: ["Phoenix", "Creston", "Dawson", "Dawson Creek", "Fort Nelson", "Hermosillo", "Mazatlan", "Whitehorse"] },
  { zone: "America/Chicago", cities: ["Chicago", "Knox", "Tell City", "Matamoros", "Menominee", "Beulah", "Center", "New Salem", "Ojinaga", "Rankin Inlet", "Resolute", "Winnipeg"] },
  { zone: "America/Mexico_City", cities: ["Mexico City", "Galapagos", "Bahia Banderas", "Belize", "Chihuahua", "Costa Rica", "El Salvador", "Guatemala", "Managua", "Merida", "Monterrey", "Regina", "Swift Current", "Tegucigalpa"] },
  { zone: "America/Lima", cities: ["Lima", "Bogota", "Panama", "Jamaica", "Cancun", "Cayman", "Coral Harbour", "Eirunepe", "Guayaquil", "Rio Branco"] },
  { zone: "America/New_York", cities: ["New York", "Toronto", "Havana", "Nassau", "Detroit", "Grand Turk", "Marengo", "Petersburg", "Vevay", "Vincennes", "Winamac", "Indianapolis", "Iqaluit", "Monticello", "Louisville", "Port-au-Prince"] },
  { zone: "Pacific/Easter", cities: ["Easter"] },
  { zone: "America/Caracas", cities: ["Caracas", "La Paz", "Guyana", "Barbados", "Anguilla", "Antigua", "Aruba", "Blanc-Sablon", "Boa Vista", "Campo Grande", "Cuiaba", "Curacao", "Dominica", "Grenada", "Guadeloupe", "Kralendijk", "Lower Princes", "Manaus", "Marigot", "Martinique", "Montserrat", "Port of Spain", "Porto Velho", "Puerto Rico", "Santo Domingo", "St Barthelemy", "St Kitts", "St Lucia", "St Thomas", "St Vincent", "Tortola"] },
  { zone: "America/Halifax", cities: ["Halifax", "Bermuda", "Glace Bay", "Goose Bay", "Moncton", "Thule"] },
  { zone: "America/St_Johns", cities: ["St Johns"] },
  { zone: "America/Miquelon", cities: ["Miquelon"] },
  { zone: "America/Santiago", cities: ["Santiago"] },
  { zone: "America/Sao_Paulo", cities: ["Sao Paulo", "Buenos Aires", "Asuncion", "Montevideo", "Paramaribo", "Araguaina", "La Rioja", "Rio Gallegos", "Salta", "San Juan", "San Luis", "Tucuman", "Ushuaia", "Bahia", "Belem", "Catamarca", "Cayenne", "Cordoba", "Coyhaique", "Fortaleza", "Jujuy", "Maceio", "Mendoza", "Punta Arenas", "Recife", "Santarem", "Palmer", "Rothera", "Stanley"] },
  { zone: "America/Godthab", cities: ["Godthab", "Scoresbysund"] },
  { zone: "America/Noronha", cities: ["Noronha", "South Georgia"] },
  { zone: "Atlantic/Azores", cities: ["Azores"] },
  { zone: "Atlantic/Cape_Verde", cities: ["Cape Verde"] },
  { zone: "Antarctica/Troll", cities: ["Troll"] },
  { zone: "Atlantic/Reykjavik", cities: ["Reykjavik", "Accra", "Dakar", "Abidjan", "Bamako", "Banjul", "Bissau", "Conakry", "Freetown", "Lome", "Monrovia", "Nouakchott", "Ouagadougou", "Sao Tome", "Danmarkshavn", "St Helena"] },
  { zone: "Europe/London", cities: ["London", "Lisbon", "Dublin", "Canary", "Faeroe", "Madeira", "Guernsey", "Isle of Man", "Jersey"] },
  { zone: "Africa/Casablanca", cities: ["Casablanca", "El Aaiun"] },
  { zone: "Africa/Lagos", cities: ["Lagos", "Algiers", "Tunis", "Kinshasa", "Bangui", "Brazzaville", "Douala", "Libreville", "Luanda", "Malabo", "Ndjamena", "Niamey", "Porto-Novo"] },
  { zone: "Europe/Paris", cities: ["Paris", "Berlin", "Madrid", "Rome", "Amsterdam", "Brussels", "Vienna", "Prague", "Warsaw", "Stockholm", "Oslo", "Copenhagen", "Belgrade", "Budapest", "Zurich", "Malta", "Ceuta", "Longyearbyen", "Andorra", "Bratislava", "Busingen", "Gibraltar", "Ljubljana", "Luxembourg", "Monaco", "Podgorica", "San Marino", "Sarajevo", "Skopje", "Tirane", "Vaduz", "Vatican", "Zagreb"] },
  { zone: "Africa/Cairo", cities: ["Cairo"] },
  { zone: "Africa/Johannesburg", cities: ["Johannesburg", "Khartoum", "Blantyre", "Bujumbura", "Gaborone", "Harare", "Juba", "Kigali", "Lubumbashi", "Lusaka", "Maputo", "Maseru", "Mbabane", "Tripoli", "Windhoek", "Kaliningrad"] },
  { zone: "Europe/Helsinki", cities: ["Helsinki", "Athens", "Nicosia", "Bucharest", "Sofia", "Riga", "Vilnius", "Tallinn", "Chisinau", "Jerusalem", "Beirut", "Famagusta", "Gaza", "Hebron", "Kiev", "Mariehamn"] },
  { zone: "Europe/Istanbul", cities: ["Istanbul", "Moscow", "Minsk", "Nairobi", "Addis Ababa", "Riyadh", "Baghdad", "Amman", "Damascus", "Kuwait", "Volgograd", "Asmera", "Dar es Salaam", "Djibouti", "Kampala", "Mogadishu", "Syowa", "Aden", "Bahrain", "Qatar", "Kirov", "Simferopol", "Antananarivo", "Comoro", "Mayotte"] },
  { zone: "Asia/Tehran", cities: ["Tehran"] },
  { zone: "Asia/Tbilisi", cities: ["Tbilisi", "Yerevan", "Baku", "Dubai", "Muscat", "Samara", "Astrakhan", "Saratov", "Ulyanovsk", "Mahe", "Mauritius", "Reunion"] },
  { zone: "Asia/Kabul", cities: ["Kabul"] },
  { zone: "Asia/Karachi", cities: ["Karachi", "Tashkent", "Almaty", "Yekaterinburg", "Dushanbe", "Ashgabat", "Mawson", "Vostok", "Aqtau", "Aqtobe", "Atyrau", "Oral", "Qostanay", "Qyzylorda", "Samarkand", "Kerguelen", "Maldives"] },
  { zone: "Asia/Colombo", cities: ["Colombo", "Calcutta"] },
  { zone: "Asia/Katmandu", cities: ["Katmandu"] },
  { zone: "Asia/Dhaka", cities: ["Dhaka", "Thimphu", "Bishkek", "Omsk", "Urumqi", "Chagos"] },
  { zone: "Asia/Rangoon", cities: ["Rangoon", "Cocos"] },
  { zone: "Asia/Bangkok", cities: ["Bangkok", "Jakarta", "Novosibirsk", "Krasnoyarsk", "Vientiane", "Phnom Penh", "Davis", "Barnaul", "Hovd", "Novokuznetsk", "Pontianak", "Saigon", "Tomsk", "Christmas"] },
  { zone: "Asia/Singapore", cities: ["Singapore", "Hong Kong", "Shanghai", "Taipei", "Manila", "Perth", "Ulaanbaatar", "Irkutsk", "Kuala Lumpur", "Brunei", "Macau", "Casey", "Kuching", "Makassar"] },
  { zone: "Australia/Eucla", cities: ["Eucla"] },
  { zone: "Asia/Seoul", cities: ["Seoul", "Tokyo", "Yakutsk", "Pyongyang", "Chita", "Dili", "Jayapura", "Khandyga", "Palau"] },
  { zone: "Australia/Darwin", cities: ["Darwin"] },
  { zone: "Australia/Brisbane", cities: ["Brisbane", "Vladivostok", "Guam", "Port Moresby", "DumontDUrville", "Ust-Nera", "Lindeman", "Saipan", "Truk"] },
  { zone: "Australia/Adelaide", cities: ["Adelaide", "Broken Hill"] },
  { zone: "Asia/Magadan", cities: ["Magadan", "Noumea", "Sakhalin", "Srednekolymsk", "Bougainville", "Efate", "Guadalcanal", "Kosrae", "Ponape"] },
  { zone: "Australia/Lord_Howe", cities: ["Lord Howe"] },
  { zone: "Australia/Sydney", cities: ["Sydney", "Melbourne", "Macquarie", "Hobart"] },
  { zone: "Pacific/Fiji", cities: ["Fiji", "Kamchatka", "Tarawa", "Anadyr", "Funafuti", "Kwajalein", "Majuro", "Nauru", "Wake", "Wallis"] },
  { zone: "Pacific/Norfolk", cities: ["Norfolk"] },
  { zone: "Pacific/Apia", cities: ["Apia", "Tongatapu", "Enderbury", "Fakaofo"] },
  { zone: "Pacific/Auckland", cities: ["Auckland", "McMurdo"] },
  { zone: "Pacific/Chatham", cities: ["Chatham"] },
  { zone: "Pacific/Kiritimati", cities: ["Kiritimati"] },
];

/** Все зоны, что знает продукт, — плоско. Нужен для проверки «есть ли
 *  сохранённая зона среди известных». */
export const TIMEZONE_OPTIONS: string[] = ZONE_GROUPS.map((g) => g.zone);
