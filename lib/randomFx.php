<?php
// file_put_contents('e:\inetpub-dev\f ile-t race.txt', __FILE__ . PHP_EOL, FILE_APPEND);

// rand ( int $min , int $max )




//--------------------------------------------------------------------------------
function fnGetRandomFormValue($forWhat, $length = 0, $ctlType = '')
{

	$qualifier 	= "";
	$list 		= '';
	$sendCount 	= 0;
	// $length 	= 0;
	$forWhat 	= trim($forWhat);
	$delimiter 	= '';
	$unique		= 0;
	// echo "forwhat: $forWhat\n";

	switch (strtolower($forWhat)) {

		case 'test':
			return "THIS IS A TEST BY THE DEVELOPER. PLEASE DISREGARD.";
			break;

		case 'ynflag':
			$list = explode(",", "262144,0");
			break;

		case 'relation':
			$list = explode(",", "Spouse,Relative,RegisteredDomesticPartner,CivilUnion,Other");
			break;

		case 'fulladdress':
			$a = fnGetRandomFormValue('mileage');
			$a .= ' ' . fnGetRandomFormValue('direction');
			$a .= ' ' . fnGetRandomFormValue('street');
			$a .= ' ' . fnGetRandomFormValue('streetypeabbrev');
			return $a;

		case "streettype":
			// $list = explode(",", "Ave,Drive,Blvd,ST,Way,,Circle,Hwy,Ln,Pky,Pl,Plaza,Ridge,Rte,Sq,Terr,Trail,Court");
			$list = array("AV", "BV", "CI", "CT", "CR", "DR", "FW", "HW", "LN", "PK", "PA", "PL", "PZ", "RD", "SQ", "ST", "TE", "TR", "TP", "WA", "");
			break;

		case "streetypeabbrev":
			$list = array("AV", "BV", "CI", "CT", "CR", "DR", "FW", "HW", "LN", "PK", "PA", "PL", "PZ", "RD", "SQ", "ST", "TE", "TR", "TP", "WA", "");
			break;

		case "alphanumeric":
			$list = str_split("BCDFGHIJLMNPRSTVWXYZ0123456789");
			break;

		case "alphanumeric_long":
			$list = str_split(" ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789");
			$length = 9;
			break;

		case "alphanumeric_med":
			$list = str_split(" ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789");
			$length = 6;
			break;

		case "alphanumeric_short":
			$list = str_split(" ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789");
			$length = 3;
			break;

		case "initials":
			$list = str_split("ABCDEFGHIJKLMNPRSTUVWY");
			$length = 2;
			break;

		case "initial":
			$list = str_split("ABCDEFGHIJKLMNPRSTUVWY");
			$length = 1;
			break;

		case "residence":
			$list = array("Own", "Rent", "Other", "Mortgage", "Family");
			break;

		case "rent":
			return rand(1000, 3000);
			break;

		case "miles":
		case "mileage":
			return rand(100, 123000);
			break;

		case "int":
			break;

		case 'smint':
		case 'smfee':
			return rand(50, 200);
			break;

		case 'yearsat':
			return rand(1, 20);
			break;

		case 'monthint':
			return rand(1, 12);
			break;

		case 'tenint':
			return rand(0, 10);
			break;

		case 'elevenint':
			return rand(0, 11);
			break;

		case "direction":
			$qualifier = "~";
			$list = array("N", "NE", "E", "SE", "S", "", "SW", "W", "NW");
			break;

		case "z_incometype":
			$qualifier = "~";
			$list = array("w", "b", "m", "a", "s", "o");
			break;

		case 'state':
			$list = array("AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY");
			$sendCount = rand(1, 5);
			break;

		case "options":
			$list = explode(',', "MOON ROOF,CD PLAYER,HEATED SEATS,CRUISE CONTROL,AM/FM/MP3 AUDIO SYSTEM,DVD, 8\" TOUCH-SCREEN"
				. ", REARVIEW MONITOR, ANDROID AUTO, APPLE CARPLAY, USB/AUXILIARY INPUT JACK, BLUETOOTH, SIDE AIRBAGS,"
				. "6-WAY POWER SEAT ADJUSTER,KEYLESS OPEN,KEYLESS START,REAR PARK ASSIST,LANE ASSIST");
			$length 	= rand(5, 10);
			$delimiter 	= ', ';
			$unique 	= 1;
			break;

		case "first":
			$list = array(
				"Francis", "Coleman", "Reynaldo", "Jessie", "Noel", "Anderson", "Jamari", "Davon", "Ibrahim", "Chance", "Rory", "Davian", "Nikolas", "Hector", "Elliot", "Seamus", "Maximus", "Malachi", "Albert", "Arnav", "Toby", "Justus", "Tucker", "Jesse", "Lee", "Jewel", "Ariel", "Laney", "Molly", "Dana", "Ashanti", "Carolina", "Dylan", "Celeste", "Emerson", "Kaley", "Madelynn", "Eve", "Lorelai", "Kathyrn", "Katelyn", "Aida", "Katelin", "Reginald", "Tomasa", "Liz", "Donn", "Lashandra", "Andree", "Marinda", "Saturnina", "Clarita", "Louella", "Fawn", "Darin", "Melita", "Aracely", "Zula", "Jamika", "Andera", "Taylor", "Judith", "Jacqualine", "Eli", "Scarlett", "Ivey", "Max", "Bula", "Burt", "Lorie", "Lawana", "Jose", "Damian", "Jamel", "Alphonse", "Tamala", "Roscoe", "Tamara", "Osvaldo", "Jarrett", "Tarra", "Pedro", "Arline", "Rickey", "Tisa", "Wanetta", "Yesenia", "Chantell", "Albina", "Freddy", "Vicente", "Tuan", "Herschel", "Granville", "Moises", "Victor", "Stanley", "Clark", "Eliseo", "Jeff", "Dee", "Luciano", "Karl", "Theodore", "Howard", "Nick", "Eddy", "Eddie", "Rolando", "Tom", "Alton", "Rayford", "Walker", "Homer", "Bud", "Vincenzo", "Art", "Luigi", "Wyatt", "Sol", "Gil", "Lee", "Maurice", "Shannon", "Heath", "Christoper", "Jewell", "Omer", "Ellis", "Giovanni", "Isaac", "Leif", "Burt", "Francesco", "Carmelo", "Jc", "Hong", "Leandro", "Lloyd", "Ximena", "Paula", "Brylee", "Makenna", "Brenna", "Dalia", "Magdalena", "Elsie", "Mariam", "Evelin", "Izabella"
			);
			break;

		case "last":
			$list = array(
				"Hopkins", "Bridges", "Mclean", "Ponce", "Carrillo", "Mendoza", "Hester", "Carroll", "Stout", "Prince", "Koch", "Fuller", "Bowman", "Nunez", "Zimmerman", "Travis", "Morse", "Osborn", "Villegas", "Steele", "Beck", "Sampson", "Mitchell", "Mccarthy", "Simmons", "Craig", "Salazar", "Hurst", "Vang", "Cochran", "Contreras", "Phillips", "Merritt", "Coleman", "Edwards", "Conley", "Newton", "Estes", "Le", "Brandt", "Velasquez", "Crawford", "Bright", "Orr", "Pittman", "Summers", "Tyler", "Rangel", "Pope", "Mccoy", "Stam", "Horace", "Catomeris", "Garrido", "Hewitt", "Pinnelli", "Pound", "Tonini", "Haviaras", "Dowler", "Duckworth", "Mackay-smith", "Maniatis", "Nobile", "Sekelsky", "Gani", "Ullman", "Kovitz", "Hedley", "Avenell", "Gersch", "Deitcher", "Sgourakes", "Kudera", "Jespersen", "Altham", "Bowlby", "Spinell", "Orwell", "Archambault", "Ridland", "Foran", "Gollamudi", "Tschinkel", "Igoe", "Hoehler", "Rivas", "Poole", "Hummel", "Blizard", "Aminoff", "Vaccaro", "Donin", "Septimus", "Calzoni", "Ekstrom", "Geidt", "Herwitz", "Gouse", "Dokidis", "Bergson", "Baptista", "Botosh", "Rosser", "Lewalski", "Rhiel", "Press", "Kenter", "Wroblewski", "George", "Dorwart", "Nicklin", "Ornelas", "Magagnoli", "Lunsford", "Tibullus", "Demong", "Parkinson", "Goss", "Merullo", "Zenga", "Hawthorne", "Melcher", "Palmer"
			);
			break;

		case "addrnumber":
		case "streetnumber":
			return rand(1000, 99999);
			break;

		case "streetaddress":
			return str_replace("  ", " ", implode(" ", array(
				fnGetRandomFormValue("addrnumber"), fnGetRandomFormValue("direction"), fnGetRandomFormValue("street"), fnGetRandomFormValue("streettype")
			)));

		case "streetname":
		case "street":
			$list = array(
				"Maple", "Oak", "Poplar", "Pine", "Sycamore", "Cedar", "Ponderosa", "Walnut", "Apple", "Pear Blossom", "Cherry", "Elm", "Elder", "Ash", "Southern", "Northern", "Eastern", "Western", "Westminster", "Franklin", "Park", "Marshall", "Cottage", "Ridge", "Rose", "2nd", "Valley View", "Monroe", "Fawn", "Union", "Cherry", "River", "4th", "Woodland", "Creek", "Myrtle", "5th", "Route 10", "Andover", "Hudson", "State", "Cedar", "Street", "Pheasant", "State", "Church", "Hillcrest", "5th South", "High", "Grant", "Court", "Park", "Brandywine", "Sherwood", "North", "Oxford", "Canal", "Amherst", "Somerset", "Tanglewood", "Meadow", "Mulberry", "Gonski", "Klasson", "Varbel", "Decarli", "Bertone", "Wynn", "Parpia", "Molea", "Peng", "Tepfer", "Heim", "Brumfield", "Cech", "Friend", "Bruzzo", "Striker", "Forhan", "Roncone", "Carrillo", "Loughlin", "Tuominen", "Barragan", "Sanna", "Hemphill", "Mccarvill", "Bleck", "Knox-olenik", "Staiger", "Hilderbrand", "Eagle", "Comstock", "Mobley", "Mackay", "Brohan", "Bosma", "Hammerness", "Catalano", "Stoppard", "Canessa", "Goddard", "Knuth", "Murison", "Littlewood", "Hand", "Tate", "Rauffenbart", "Martel", "Kamal", "Schopf", "Bosquet", "Colin", "Kravitz", "Minsky", "Seterdahl", "Seshadri", "Sekey", "Kisler", "Fabian", "Kenny", "Michaelsen", "Bigoness", "Himmelfarb", "Rigos", "Lewko", "Fossey", "Hyams"
			);
			break;

		case "city":
			$list = array(
				"Elberon", "West Wildwood", "Redwood", "Salina", "Arcola", "Salisbury", "Lemannville", "Muldrow", "Eagle Harbor", "Midvale", "Hollow Creek", "Oak Grove Heights", "Onward", "Kingstown", "Yogaville", "Marblehead", "Sulphur", "Castle Pines", "Milledgeville", "Willow Canyon", "Ridley Park", "Lattimer", "Teterboro", "Fort Jennings", "Cow Creek", "Weigelstown", "Hormigueros", "Northwest Harwinton", "Farnam", "Cutchogue", "Lannon", "East Brewton", "Camargito", "Valparaiso", "Meadow View Addition", "Elkhorn", "Auburndale", "Springwater Hamlet", "South Vinemont", "Moss Beach", "Earl Park", "Beluga", "McGregor", "Iglesia Antigua", "Campbellsville", "Eastgate", "Cherry Tree", "San Felipe", "Concho", "South Bloomfield", "Glen Echo Park", "Green Camp", "Matlacha Isles", "Mankato", "Hurlock", "Cokato", "Pecan Gap", "Masury", "Oxnard", "Braham", "Kahului", "Shoreham", "Las Nutrias", "Wekiwa Springs", "Spade", "Commerce City", "The Dalles", "Powder Springs", "Lake Sumner", "Blue Point", "Elverson", "Marianna", "Garrison", "Kulpsville", "Magnolia", "Lebo", "Versailles", "Charles City", "Fox Park", "Larkin Valley", "North Plains", "Flordell Hills", "Leitchfield", "Schiller Park", "Hercules", "Cushing", "Alder", "Palm River", "Chappell", "Urbana", "Jasper", "Bonny Doon", "Blacksville", "Hallwood", "Grand View", "Lakehurst", "Standing Pine", "Bemus Point"
			);
			break;

		case "employer":
		case "company":
			$list = array(
				"Diversified Data Call Centers", "Dixie Trophies Inc", "X P Software", "Compu Direct Inc", "Sewing Machines & Things", "Highpointe Hotel Corp", "Kennedy School Hotel", "Ski Brule", "Club Grill", "Dee's Diner", "The Frozen Grill", "Intelligentsia Coffee & Tea Inc.", "Lucky Peking", "Sunset Yogurt Factory", "Fruta Organica Organic Fruit", "Vainilla Bean Bake Shop Inc", "Jeffs Seafood And Chowder House", "Better Days Sports Bar", "Blue Bell Senior Camp Inc", "Wesley Acres United Methodist", "New Wai Hing", "Good Food Colorado", "Pizza Classic", "Ranny's Mind Over Matter", "Mt Vernon Hs", "Dairy Specialists", "Taylor Livestock Corp", "Ronnie Redd", "Ward Feed Yard Inc", "Fowler Minnow Farms", "Detaglia Industries Inc", "Mad Macs", "Municipal Analysts Group Of New York", "Sunshine Farms", "Gulf Marine Institute Of Tech", "Clancy's Transfer & Storage Inc", "Cathleen Kocsis", "Dept Corrections Trnsp Unit", "Deauville Inn", "The Dugout", "B&B Hydraulics", "J2 Laboratories Inc", "Howard Perry & Walston", "Dahl Trucking"
			);
			break;

		case "occupation":
		case "job":
			$list = array(
				"Logistician", "Logistics Analyst", "Logistics Coordinator", "Logistics Planner", "Logistics Specialist", "Applications Analyst", "Computer Systems Analyst", "Computer Consultant", "Data Processing", "Systems Analyst", "Information Analyst", "Systems Planner", "Programmer Analyst", "Systems Architect", "Catalogue Illustrator", "Graphic Artist", "Graphic Designer", "Visual Designer", "Home Health Aide", "Home Health Attendant", "Home Hospice Aide", "Flight Crew Time Clerk", "Payroll Bookkeeper", "Personnel Scheduler", "Attendance Clerk", "Time Clerk", "Timekeeper", "Electronics", "Engineer", "Professor", "Appellate Conferee", "Wool Grader", "Service Caseworker", "Boatswain", "Cook", "First Mate", "Psychiatrist", "Number One", "Weapons Specialist", "Security", "First Officer", "Second Officer", "Radio Operator", "Coal Scuttler", "Groundskeeping", "Motorboat Mechanic", "Supervisor", "Machinist", "Design Engineer", "Housekeeping", "Concierge", "Drywall Installer", "Food Scientist", "Paralegal", "Budget analyst", "Executive Assistant", "Secretary", "Body removal", "Crime scene cleaner"
			);
			break;

		case "sidehustle":
			$list = ["Freelance Writing", "Graphic Design", "Web Development", "Dropshipping", "Print on Demand", "Affiliate Marketing", "Online Tutoring", "Virtual Assistant", "Social Media Management", "Stock Photography", "Selling Digital Products", "Handmade Crafts", "Flipping Items", "Blogging", "YouTube Channel", "Podcasting", "App Development", "Pet Sitting", "House Cleaning", "Rideshare Driving", "Delivery Services", "Online Course Creation", "Consulting", "Tech Support", "Copywriting", "Resume Writing", "Voiceover Work", "Data Entry", "Translation Services", "Etsy Store", "Amazon FBA", "Self-Publishing", "Video Editing", "Transcription", "Remote Customer Support", "Selling NFTs", "Stock Trading", "Renting Out Property", "Event Planning", "Personal Training", "Meal Prep Services", "Car Detailing", "Local Tour Guide", "Handyman Services"];
			break;

		case "pwd":
			$list = array(
				"Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "L", "K", "J", "H", "G", "F", "D", "S", "A", "Z", "X", "C", "V", "B", "N", "M", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "_", "+", "=", "$", "#", "@", "!", "?"
			);
			break;

		case "vin":
			$list = array(
				"W", "E", "R", "T", "Y", "P", "L", "J", "H", "G", "F", "D", "S", "Z", "X", "C", "V", "B", "N", "M", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"
			);
			$length = 17;
			break;

		case 'alphabet':
			$list = str_split("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_");
			break;

		case "initial":
			$list = array("A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "R", "S", "T", "V");
			break;

		case "relation":
			$qualifier = "~";
			$list = array("S", "SS", "P", "C", "O");
			break;

		case "employmentstatus":
		case "employed":
			$list = array("Employed - Full Time", "Employed - Part Time", 'Self-Employed', 'Other', 'Employed-Hourly'); // , "Unemployed", 'Student', 'Disability', "Retired", 'Military'
			break;

		case "incometype":
			$list = array("Weekly", "Bi-Weekly", "Monthly", "Annually", 'Semi-Monthly', 'Other');
			break;

		case "phone":
			return implode("-", [rand(111, 999), rand(111, 999), rand(1000, 9999)]);
			break;

		case "ssn":
			return implode("-", [rand(111, 999), rand(10, 99), rand(1000, 9999)]);
			break;

		case "dob":
			if ($ctlType == 'htmldate') {
				return implode("-", [rand(1990, 1960), substr('0' . rand(12, 1), -2), substr('0' . rand(1, 28), -2)]);
			} else {
				return implode("/", [rand(12, 1), rand(1, 28), rand(1990, 1960)]);
			}
			break;

		case "dob-iso":
			return implode("-", [rand(1990, 1960), substr('0' . rand(12, 1), -2), substr('0' . rand(28, 1), -2)]);
			break;

		case "timeat":
			return implode("-", [rand(2, 10), rand(0, 11)]);
			break;

		case "yearsat":
			return rand(2, 10);
			break;

		case "monthsat":
			return rand(0, 11);
			break;

		case "zipcode":
		case "zip":
			return rand(12345, 99123);
			break;

		case "smallint":
			return rand(10, 999);
			break;

		case 'midprice':
		case 'price':
			return rand(8000, 20000);
			break;

		case 'smprice':
			return rand(4000, 8000);
			break;

		case "salary":
			return rand(500, 8000);
			break;

		case "salary-annual":
			return rand(6144, 61476);
			break;

		case 'make':
			$list = explode("|", "Ford|Chevrolet|Buick|Volkswagon|Honda|GMC|Dodge|Mitsubishi|Cadillac");
			break;

		case 'modelyear':
			return rand(1990, (int)date("Y"));

		case 'futuredate':
			$date = new DateTime();
			$interval = date_interval_create_from_date_string("2 years");
			$ret = $date->add($interval);
			$y = date_format($ret, "Y");
			$m = substr('0' . rand(12, 1), -2);
			$d = substr('0' . rand(28, 1), -2);
			return implode("-", [$y, $m, $d]);

		case 'email':
			return 'test_' . fnGetRandomFormValue('alphabet', rand(5, 10)) . "@test.com";

		case 'model':
			$list = explode("|", "TL|TSX|Insight|Clarity|Durango|Cruiser|Routan|Ridgeline|Sahara|Andes|Rocky XL|Matzaball|Countercheque|Palace|Tumbler|Lavalamp|Swandive|Dragon|Scale|Piano|300M|400XL|500RPG|SUX6000");
			break;

		case 'otherincome':
			$list = explode("|", "self-employed|Nutrilife|flipping houses|internet data entry|selling cars|selling timeshares|uber|air BNB|investing|shylocking|real estate|blogging|technical writing|housekeeping|baby sitting|amazon associate sales|vending machines|accounting business|pro poker player");
			break;

		case 'downpmt':
			$list = array(0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000);
			break;

		default:
			preg_match('/date(\+|-)(\d+)/', $forWhat, $b);
			if (count((array)$b) > 0) {
				return date('m/d/Y', strtotime($b[1] . $b[2] . " days"));
			} else {
				// echo $forWhat;
				if (strpos($forWhat, ":") == 0) {
					return $forWhat;
				}
			}
	}

	$length = nullif($length, 0) ?? 1;

	$retVal = '';

	$out  = [];

	// now that we've built the whole thing, there will be some left using meta tokens, :[id=

	// the following block only counts if $list has a length, otherwise it skips entirely
	for ($x = 1; $x <= $length; $x++) {
		$curVal = rand(0, count((array)$list) - 1);
		if (isset($list[$curVal])) {
			$out[] = $list[$curVal];
		}
	}

	if (count((array)$out) > 0) {
		if ($unique == 1) {
			$out = array_unique($out);
		}
		$retVal = trim(join($delimiter, $out));
	}

	if ($forWhat == "last") {
		$retVal .= "-TEST";
	}
	return $retVal;
}


//--------------------------------------------------------------------------------

function guid()
{
	if (function_exists('com_create_guid')) {
		return com_create_guid();
	} else {
		mt_srand((float)microtime() * 10000); //optional for php 4.2.0 and up.
		$charid = strtoupper(md5(uniqid(rand(), true)));
		$hyphen = chr(45); // "-"
		$uuid = chr(123) // "{"
			. substr($charid, 0, 8) . $hyphen
			. substr($charid, 8, 4) . $hyphen
			. substr($charid, 12, 4) . $hyphen
			. substr($charid, 16, 4) . $hyphen
			. substr($charid, 20, 12)
			. chr(125); // "}"
		return $uuid;
	}
}

