// Dynamic event pool: random national events, queued as "pending decisions."
// Each choice carries either a deterministic `delta`, or a probabilistic
// `chance` + `successDelta`/`failDelta` pair (investment-style choices) whose
// true odds are hidden until you pay to "hire experts." Decisions can be
// postponed; left too long, they expire with a negative default consequence.

const EVENT_POOL = [
  { title: "EU Structural Fund Offer", body: "The European Commission offers a €120M infrastructure grant, conditional on co-financing 15% from the national budget.", choices: [
    { label: "Accept and co-finance", delta: { treasury: 102e6, stability: 1 } },
    { label: "Negotiate a lower co-financing share", delta: { treasury: 60e6, stability: 0 } },
    { label: "Decline", delta: {} },
  ]},
  { title: "Industrial Accident — Celje Steel Mill", body: "A fire at a private steel mill in Celje has halted production and injured several workers.", choices: [
    { label: "Deploy full emergency relief", delta: { treasury: -8e6, stability: 2 } },
    { label: "Partial relief funding", delta: { treasury: -3e6, stability: 1 } },
    { label: "Let insurance handle it", delta: { stability: -2 } },
  ]},
  { title: "Corruption Scandal", body: "Investigative journalists allege irregularities in a public procurement contract linked to a senior ministry official. How you respond is a gamble on whether the public believes you.", choices: [
    { label: "Launch full independent investigation", delta: { treasury: -3e6, stability: 2, crimeRate: -4, happiness: 1 } },
    { label: "Dismiss the official as a goodwill gesture", delta: { stability: -1, crimeRate: -1 } },
    // A gamble: if the public buys it you look strong; if not, backlash.
    { label: "Publicly deny any wrongdoing", chance: 0.45, successDelta: { stability: 3, happiness: 1 }, failDelta: { stability: -8, crimeRate: 4, happiness: -3 } },
    { label: "Quietly bury the story with media pressure", chance: 0.35, successDelta: { stability: 1 }, failDelta: { stability: -10, crimeRate: 5, happiness: -4 } },
  ]},
  { title: "Foreign Investment Proposal", body: "A multinational electronics firm proposes building a semiconductor plant near Maribor, requesting tax incentives.", chance: true, expertsCost: 4e6, choices: [
    { label: "Grant full incentives", chance: 0.62, successDelta: { treasury: -15e6, gdpGrowth: 0.0035 }, failDelta: { treasury: -15e6, stability: -2 } },
    { label: "Grant partial incentives", chance: 0.75, successDelta: { treasury: -6e6, gdpGrowth: 0.0015 }, failDelta: { treasury: -6e6 } },
    { label: "Reject the proposal", delta: {} },
  ]},
  { title: "Border Incident", body: "A minor cross-border smuggling confrontation near the Croatian border has drawn media attention.", choices: [
    { label: "Reinforce border police", delta: { treasury: -3e6, stability: 1 } },
    { label: "Request joint patrol with neighboring state", delta: { treasury: -1e6, stability: 1 } },
    { label: "Downplay the incident", delta: { stability: -1 } },
  ]},
  { title: "Scientific Breakthrough", body: "A national research institute reports a breakthrough in battery materials with commercial potential.", choices: [
    { label: "Fund a domestic spin-off company", delta: { treasury: -5e6, researchBoost: { mult: 0.25, days: 180 }, gdpGrowth: 0.0006 } },
    { label: "License the patent abroad", delta: { treasury: 20e6 } },
    { label: "Keep it classified for military R&D", delta: { researchBoost: { mult: 0.3, days: 240 } } },
  ]},
  { title: "Public Sector Strike Threat", body: "Healthcare and education unions threaten a general strike over stagnant wages.", choices: [
    { label: "Raise public wages in full", delta: { treasury: -25e6, stability: 3 } },
    { label: "Offer a partial raise", delta: { treasury: -12e6, stability: 1 } },
    { label: "Hold firm", delta: { stability: -5 } },
  ]},
  { title: "Drought Warning — Agricultural Regions", body: "Meteorologists warn of a severe summer drought affecting the Pomurje agricultural region.", choices: [
    { label: "Subsidize irrigation projects", delta: { treasury: -10e6, stability: 1 } },
    { label: "Emergency water rationing only", delta: { treasury: -2e6, stability: -1 } },
    { label: "No intervention", delta: { stability: -2 } },
  ]},
  { title: "NATO Exercise Invitation", body: "NATO invites Slovenia to host a joint multinational training exercise on its territory — a routine alliance commitment, not a response to any conflict.", deadlineDays: 6, expiredConsequence: { stability: -3 }, choices: [
    { label: "Host the full exercise", delta: { treasury: -6e6, stability: 2 } },
    { label: "Contribute observers only", delta: { treasury: -1e6, stability: 1 } },
    { label: "Decline this cycle", delta: { stability: -1 } },
  ]},
  { title: "Refugee Crisis at the Border", body: "A sudden wave of asylum seekers has arrived at the southeastern border, straining local services.", choices: [
    { label: "Open reception centers", delta: { treasury: -14e6, stability: -1 } },
    { label: "Limited humanitarian corridor", delta: { treasury: -6e6, stability: 0 } },
    { label: "Tighten border controls", delta: { treasury: -4e6, stability: 1 } },
  ]},

  { title: "Startup Accelerator Pitch", body: "A group of young entrepreneurs pitches a state-backed startup accelerator focused on green tech.", chance: true, expertsCost: 2e6, choices: [
    { label: "Fund it", chance: 0.55, successDelta: { treasury: -8e6, gdpGrowth: 0.0012 }, failDelta: { treasury: -8e6 } },
    { label: "Offer a smaller pilot grant", chance: 0.7, successDelta: { treasury: -2e6, gdpGrowth: 0.0004 }, failDelta: { treasury: -2e6 } },
    { label: "Pass", delta: {} },
  ]},
  { title: "Alpine Ski Resort Investment", body: "A tourism consortium proposes expanding an Alpine ski resort, betting on future snow reliability.", chance: true, expertsCost: 3e6, choices: [
    { label: "Co-invest with the state", chance: 0.5, successDelta: { treasury: -12e6, gdpGrowth: 0.0010 }, failDelta: { treasury: -12e6, stability: -1 } },
    { label: "Approve permits only, no funding", delta: { stability: 0 } },
    { label: "Reject over climate concerns", delta: { stability: 1 } },
  ]},
  { title: "Pharmaceutical Export Deal", body: "Domestic pharma company Krka proposes a major export deal requiring state export-credit backing.", chance: true, expertsCost: 3e6, choices: [
    { label: "Back the deal", chance: 0.7, successDelta: { treasury: 25e6 }, failDelta: { treasury: -10e6, stability: -1 } },
    { label: "Partial backing", chance: 0.85, successDelta: { treasury: 10e6 }, failDelta: { treasury: -4e6 } },
    { label: "Decline to back it", delta: {} },
  ]},
  { title: "Data Center Bid", body: "A cloud computing giant is scouting Central Europe for a new data center and Slovenia is on the shortlist.", chance: true, expertsCost: 5e6, choices: [
    { label: "Offer aggressive incentives", chance: 0.45, successDelta: { treasury: -20e6, gdpGrowth: 0.0025 }, failDelta: { treasury: -20e6, stability: -2 } },
    { label: "Offer modest incentives", chance: 0.65, successDelta: { treasury: -8e6, gdpGrowth: 0.0010 }, failDelta: { treasury: -8e6 } },
    { label: "Let them choose elsewhere", delta: {} },
  ]},
  { title: "Wine Export Tariff Dispute", body: "A trading partner threatens tariffs on Slovenian wine exports over a labeling dispute.", choices: [
    { label: "Negotiate a compromise", delta: { treasury: -2e6, stability: 1 } },
    { label: "Retaliate with counter-tariffs", delta: { treasury: -6e6, stability: -1 } },
    { label: "Accept the tariffs", delta: { treasury: -4e6 } },
  ]},
  { title: "Cross-Border Rail Link Proposal", body: "Austria proposes co-financing a faster rail link between Ljubljana and Vienna.", chance: true, expertsCost: 3e6, choices: [
    { label: "Co-finance the project", chance: 0.68, successDelta: { treasury: -18e6, gdpGrowth: 0.0012 }, failDelta: { treasury: -18e6 } },
    { label: "Support in principle, minimal funding", delta: { stability: 1 } },
    { label: "Decline", delta: {} },
  ]},
  { title: "Housing Affordability Crisis", body: "Young families in Ljubljana are increasingly priced out of the housing market.", choices: [
    { label: "Launch a public housing program", delta: { treasury: -18e6, stability: 3 } },
    { label: "Cap rent increases", delta: { stability: 2, gdpGrowth: -0.0004 } },
    { label: "Leave it to the market", delta: { stability: -2 } },
  ]},
  { title: "Teacher Shortage", body: "Rural schools report a growing shortage of qualified teachers.", choices: [
    { label: "Raise teacher salaries nationally", delta: { treasury: -14e6, stability: 2 } },
    { label: "Rural relocation bonuses only", delta: { treasury: -4e6, stability: 1 } },
    { label: "No action", delta: { stability: -2 } },
  ]},
  { title: "Cybersecurity Breach", body: "A ransomware attack disrupts several municipal government IT systems.", choices: [
    { label: "Pay the ransom to restore services quickly", delta: { treasury: -3e6, stability: -1 } },
    { label: "Refuse and rebuild systems", delta: { treasury: -8e6, stability: 1 } },
    { label: "Call in EU cyber-response support", delta: { treasury: -1e6, stability: 1 } },
  ]},
  { title: "Wildfire in the Karst", body: "A wildfire breaks out in the Karst region near Sežana amid dry conditions.", choices: [
    { label: "Full firefighting mobilization", delta: { treasury: -6e6, stability: 1 } },
    { label: "Standard response only", delta: { treasury: -2e6 } },
    { label: "Request EU firefighting aircraft", delta: { treasury: -1e6, stability: 1 } },
  ]},
  { title: "Flooding on the Sava", body: "Heavy rainfall causes the Sava river to flood low-lying areas near Krško.", choices: [
    { label: "Full disaster relief package", delta: { treasury: -12e6, stability: 2 } },
    { label: "Limited emergency aid", delta: { treasury: -4e6 } },
    { label: "Ask residents to self-insure going forward", delta: { stability: -2 } },
  ]},
  { title: "University Ranking Slip", body: "The University of Ljubljana drops in international rankings, prompting public debate.", choices: [
    { label: "Increase university funding", delta: { treasury: -10e6, researchBoost: { mult: 0.2, days: 150 } } },
    { label: "Commission a reform review", delta: { treasury: -1e6 } },
    { label: "Dismiss the rankings as unreliable", delta: { stability: -1 } },
  ]},
  { title: "National Airline Bailout Request", body: "The struggling national carrier requests a state bailout to avoid bankruptcy.", chance: true, expertsCost: 3e6, choices: [
    { label: "Full bailout", chance: 0.4, successDelta: { treasury: -30e6, stability: 2 }, failDelta: { treasury: -30e6, stability: -3 } },
    { label: "Partial bridge loan", chance: 0.6, successDelta: { treasury: -10e6 }, failDelta: { treasury: -10e6, stability: -1 } },
    { label: "Let it fail", delta: { stability: -3 } },
  ]},
  { title: "Minimum Wage Debate", body: "Unions demand a significant minimum wage increase; employers warn of job losses.", choices: [
    { label: "Raise minimum wage significantly", delta: { stability: 3, gdpGrowth: -0.0006 } },
    { label: "Modest increase", delta: { stability: 1 } },
    { label: "Freeze it", delta: { stability: -2 } },
  ]},
  { title: "EU Digital Sovereignty Fund", body: "The EU offers co-funding for a national sovereign cloud infrastructure project.", chance: true, expertsCost: 2e6, choices: [
    { label: "Apply for full funding", chance: 0.6, successDelta: { treasury: 15e6, researchBoost: { mult: 0.15, days: 120 } }, failDelta: { treasury: -3e6 } },
    { label: "Apply for a smaller pilot", chance: 0.8, successDelta: { treasury: 6e6 }, failDelta: { treasury: -1e6 } },
    { label: "Skip it", delta: {} },
  ]},
  { title: "Whistleblower Allegations", body: "A former defense ministry employee alleges irregular equipment procurement.", choices: [
    { label: "Open a formal inquiry", delta: { treasury: -2e6, stability: 1 } },
    { label: "Quiet internal audit", delta: { stability: -1 } },
    { label: "Ignore it", delta: { stability: -4 } },
  ]},
  { title: "Alpine Glacier Retreat Report", body: "Scientists report accelerated glacier retreat in the Julian Alps, raising long-term water security concerns.", choices: [
    { label: "Fund a water security taskforce", delta: { treasury: -5e6, stability: 1 } },
    { label: "Commission further study", delta: { treasury: -1e6 } },
    { label: "No action", delta: {} },
  ]},
  { title: "Diaspora Investment Fund", body: "Slovenian expatriates propose a diaspora investment fund for domestic startups.", chance: true, expertsCost: 1.5e6, choices: [
    { label: "Match diaspora contributions", chance: 0.65, successDelta: { treasury: -5e6, gdpGrowth: 0.0006 }, failDelta: { treasury: -5e6 } },
    { label: "Offer tax breaks instead", delta: { stability: 1 } },
    { label: "Decline involvement", delta: {} },
  ]},
  { title: "Public Broadcasting Funding Dispute", body: "The national broadcaster faces a funding cut proposal amid political pressure over editorial independence.", choices: [
    { label: "Protect the funding", delta: { treasury: -4e6, stability: 1 } },
    { label: "Moderate cuts", delta: { treasury: 2e6, stability: -1 } },
    { label: "Deep cuts", delta: { treasury: 6e6, stability: -3 } },
  ]},
  { title: "Postal Service Modernization", body: "The state postal service requests capital for fleet electrification and automation.", delta_note: true, choices: [
    { label: "Fund full modernization", delta: { treasury: -9e6, gdpGrowth: 0.0004 } },
    { label: "Partial funding", delta: { treasury: -3e6 } },
    { label: "Defer indefinitely", delta: { stability: -1 } },
  ]},
  { title: "Regional Election Results", body: "Regional elections shift the political balance in several municipal councils.", choices: [
    { label: "Seek broader coalition cooperation", delta: { stability: 2 } },
    { label: "Maintain current course", delta: {} },
    { label: "Confrontational stance toward opposition regions", delta: { stability: -2 } },
  ]},
  { title: "Veterans' Benefits Review", body: "Veterans' associations request expanded benefits and healthcare priority.", choices: [
    { label: "Expand benefits", delta: { treasury: -6e6, stability: 2 } },
    { label: "Modest improvements", delta: { treasury: -2e6, stability: 1 } },
    { label: "No changes", delta: { stability: -1 } },
  ]},
  { title: "Illegal Logging Investigation", body: "Environmental inspectors uncover illegal logging operations in state forests.", choices: [
    { label: "Prosecute and increase forest patrols", delta: { treasury: -3e6, stability: 1, crimeRate: -2 } },
    { label: "Fine and warn only", delta: { treasury: 1e6 } },
    { label: "Look the other way", delta: { stability: -3, crimeRate: 4 } },
  ]},
  { title: "Chip Shortage Hits Automotive Sector", body: "A global semiconductor shortage disrupts Slovenia's automotive parts industry.", choices: [
    { label: "Subsidize affected manufacturers", delta: { treasury: -8e6, gdpGrowth: 0.0003 } },
    { label: "Offer temporary tax relief", delta: { treasury: -3e6 } },
    { label: "No intervention", delta: { gdpGrowth: -0.0008 } },
  ]},
  { title: "Judicial Backlog Crisis", body: "Courts report a severe backlog of pending cases, undermining public trust.", choices: [
    { label: "Fund additional judges and staff", delta: { treasury: -7e6, stability: 2 } },
    { label: "Streamline procedures only", delta: { treasury: -1e6, stability: 1 } },
    { label: "No action", delta: { stability: -2 } },
  ]},
  { title: "Space Industry Pitch", body: "A small aerospace startup pitches a national space agency partnership for satellite launches.", chance: true, expertsCost: 2e6, choices: [
    { label: "Back the venture", chance: 0.35, successDelta: { treasury: -10e6, researchBoost: { mult: 0.5, days: 365 }, gdpGrowth: 0.0008 }, failDelta: { treasury: -10e6 } },
    { label: "Fund research only, no launch commitment", delta: { treasury: -2e6, researchBoost: { mult: 0.15, days: 120 } } },
    { label: "Pass", delta: {} },
  ]},
  { title: "Public Transit Fare Debate", body: "Advocates push for free public transit nationwide to reduce emissions and congestion.", choices: [
    { label: "Make transit free nationwide", delta: { treasury: -16e6, stability: 3 } },
    { label: "Free transit for students/seniors only", delta: { treasury: -5e6, stability: 1 } },
    { label: "Keep current fares", delta: {} },
  ]},
  { title: "Diplomatic Recognition Request", body: "A newly independent state requests Slovenia's diplomatic recognition.", choices: [
    { label: "Grant recognition", delta: { stability: 1 } },
    { label: "Coordinate with EU partners first", delta: {} },
    { label: "Decline for now", delta: { stability: -1 } },
  ]},
  { title: "Hydrogen Bus Pilot Program", body: "A consortium proposes piloting hydrogen fuel-cell buses in Ljubljana's public transit fleet.", chance: true, expertsCost: 2e6, choices: [
    { label: "Fund the pilot", chance: 0.55, successDelta: { treasury: -7e6, gdpGrowth: 0.0005 }, failDelta: { treasury: -7e6 } },
    { label: "Small-scale trial only", chance: 0.8, successDelta: { treasury: -2e6 }, failDelta: { treasury: -2e6 } },
    { label: "Stick with electric buses", delta: {} },
  ]},
  { title: "Miner Pension Dispute", body: "Former Velenje coal miners demand pension guarantees as the mine winds down operations.", choices: [
    { label: "Guarantee full pensions", delta: { treasury: -9e6, stability: 3 } },
    { label: "Phased transition support", delta: { treasury: -4e6, stability: 1 } },
    { label: "No special guarantees", delta: { stability: -3 } },
  ]},
  { title: "Startup Visa Program", body: "Immigration officials propose a fast-track visa for foreign tech entrepreneurs.", choices: [
    { label: "Launch the program", delta: { treasury: -1e6, gdpGrowth: 0.0006 } },
    { label: "Small pilot only", delta: { gdpGrowth: 0.0002 } },
    { label: "Reject", delta: {} },
  ]},
  { title: "Karst Cave Tourism Dispute", body: "Environmentalists clash with tourism operators over visitor limits at Postojna Cave.", choices: [
    { label: "Impose visitor caps", delta: { stability: 1, gdpGrowth: -0.0002 } },
    { label: "Compromise seasonal limits", delta: { stability: 0 } },
    { label: "No new limits", delta: { stability: -1 } },
  ]},
  { title: "Cross-Party Corruption Probe", body: "Parliament debates launching a cross-party anti-corruption commission.", choices: [
    { label: "Support the commission", delta: { stability: 2, treasury: -1e6 } },
    { label: "Support with limited scope", delta: { stability: 1 } },
    { label: "Block it", delta: { stability: -3 } },
  ]},
  { title: "Agricultural Land Foreign Ownership", body: "Debate erupts over foreign investors purchasing Slovenian farmland.", choices: [
    { label: "Restrict foreign ownership", delta: { stability: 2, gdpGrowth: -0.0003 } },
    { label: "Allow with regulation", delta: {} },
    { label: "No restrictions", delta: { stability: -1, gdpGrowth: 0.0003 } },
  ]},
  { title: "National Broadband Gaps", body: "Rural areas report persistent gaps in broadband internet coverage.", choices: [
    { label: "Fund full rural broadband rollout", delta: { treasury: -11e6, stability: 2 } },
    { label: "Partial rollout", delta: { treasury: -4e6, stability: 1 } },
    { label: "Rely on private providers", delta: { stability: -1 } },
  ]},
  { title: "Historic Building Restoration", body: "Ljubljana's old town requests funding to restore crumbling historic facades.", choices: [
    { label: "Fund full restoration", delta: { treasury: -6e6, stability: 2 } },
    { label: "Partial funding", delta: { treasury: -2e6, stability: 1 } },
    { label: "Decline", delta: { stability: -1 } },
  ]},
  { title: "Cross-Border Energy Dispute", body: "A dispute arises with a neighboring country over shared hydropower revenue on a border river.", choices: [
    { label: "Negotiate a new revenue-sharing deal", delta: { treasury: -2e6, stability: 1 } },
    { label: "Take a hard line in talks", delta: { stability: -1 } },
    { label: "Accept current terms", delta: {} },
  ]},
  { title: "National Blood Donation Shortage", body: "Hospitals report critically low blood donation reserves.", choices: [
    { label: "Launch a national donation campaign", delta: { treasury: -1e6, stability: 1 } },
    { label: "Import reserves from EU partners", delta: { treasury: -3e6 } },
    { label: "No special action", delta: { stability: -1 } },
  ]},
  { title: "AI Regulation Debate", body: "Parliament debates new national rules on artificial intelligence use in public services.", choices: [
    { label: "Adopt strict regulation", delta: { stability: 1, gdpGrowth: -0.0003 } },
    { label: "Light-touch regulation", delta: {} },
    { label: "No new regulation yet", delta: { gdpGrowth: 0.0002 } },
  ]},
  { title: "Winter Energy Price Spike", body: "A cold snap drives sharp increases in household energy bills.", choices: [
    { label: "Subsidize household energy bills", delta: { treasury: -13e6, stability: 3 } },
    { label: "Targeted aid for low-income households", delta: { treasury: -5e6, stability: 1 } },
    { label: "No intervention", delta: { stability: -3 } },
  ]},
  { title: "Sister-City Partnership Offer", body: "A city abroad proposes a formal sister-city partnership with Ljubljana focused on cultural exchange.", choices: [
    { label: "Accept the partnership", delta: { stability: 1 } },
    { label: "Accept with limited scope", delta: {} },
    { label: "Decline", delta: {} },
  ]},
  { title: "Domestic Drone Delivery Trial", body: "A logistics startup requests permission to trial drone package delivery in rural areas.", chance: true, expertsCost: 1e6, choices: [
    { label: "Approve the trial with funding", chance: 0.6, successDelta: { treasury: -2e6, gdpGrowth: 0.0004 }, failDelta: { treasury: -2e6 } },
    { label: "Approve without funding", delta: {} },
    { label: "Deny over safety concerns", delta: { stability: 1 } },
  ]},

  { title: "Youth Emigration Wave", body: "Statistics show a growing number of young graduates leaving Slovenia for better-paying jobs abroad.", choices: [
    { label: "Launch a 'Return to Slovenia' incentive program", delta: { treasury: -12e6, population: 3000, gdpGrowth: 0.0004, happiness: 2 } },
    { label: "Tax breaks for young professionals who stay", delta: { treasury: -6e6, population: 1200, happiness: 1 } },
    { label: "Accept the trend as inevitable", delta: { population: -4000, gdpGrowth: -0.0003 } },
  ]},
  { title: "Baby Bonus Debate", body: "Demographers warn of a shrinking workforce as the population ages; family groups push for a one-time birth bonus.", choices: [
    { label: "Introduce a generous birth bonus", delta: { treasury: -10e6, fertilityRate: 0.08, happiness: 2 } },
    { label: "Modest bonus tied to income", delta: { treasury: -4e6, fertilityRate: 0.03 } },
    { label: "No new spending", delta: {} },
  ]},
  { title: "Organized Crime Crackdown Opportunity", body: "Police intelligence identifies a cross-border smuggling ring operating through Slovenian ports and highways.", choices: [
    { label: "Fund a major joint task force", delta: { treasury: -9e6, crimeRate: -8, stability: 2 } },
    { label: "Standard police operation", delta: { treasury: -2e6, crimeRate: -3 } },
    { label: "Leave it to routine policing", delta: { crimeRate: 2 } },
  ]},
  { title: "Automation Hits the Factory Floor", body: "A major manufacturer announces plans to automate a large share of its production line, citing competitiveness.", choices: [
    { label: "Subsidize worker retraining alongside automation", delta: { treasury: -8e6, gdpGrowth: 0.0010, unemploymentRate: 0.5 } },
    { label: "Allow automation, no support program", delta: { gdpGrowth: 0.0014, unemploymentRate: 2.2, happiness: -3 } },
    { label: "Restrict automation to protect jobs", delta: { gdpGrowth: -0.0006, unemploymentRate: -0.8, happiness: 1 } },
  ]},
  { title: "University Brain Drain to Research Hubs", body: "Several top researchers accept offers from foreign universities offering better funding.", choices: [
    { label: "Counter-offer with a national research fund", delta: { treasury: -7e6, researchBoost: { mult: 0.3, days: 240 } } },
    { label: "Let them go, focus on training new researchers", delta: { researchBoost: { mult: -0.1, days: 90 }, treasury: -1e6 } },
    { label: "No action", delta: { research: -2500 } },
  ]},
  { title: "Elderly Care Crisis", body: "Nursing homes report severe understaffing as Slovenia's population continues to age.", choices: [
    { label: "Major investment in elder care staffing", delta: { treasury: -11e6, happiness: 3, stability: 1 } },
    { label: "Recruit foreign care workers", delta: { treasury: -4e6, population: 1500, happiness: 1 } },
    { label: "No intervention", delta: { happiness: -3 } },
  ]},
  { title: "Domestic Arms Export Opportunity", body: "A foreign government requests to purchase surplus Slovenian military equipment.", choices: [
    { label: "Approve the sale", delta: { treasury: 14e6, manpower: -200 } },
    { label: "Approve a smaller, vetted sale", delta: { treasury: 6e6, manpower: -80 } },
    { label: "Decline on ethical grounds", delta: { stability: 1 } },
  ]},
  { title: "National Broadcaster Exposes Municipal Fraud", body: "An investigative report reveals municipal officials diverting infrastructure funds for personal use.", choices: [
    { label: "Prosecute and claw back funds", delta: { treasury: 3e6, crimeRate: -3, stability: 2 } },
    { label: "Quiet administrative penalties", delta: { crimeRate: 1, stability: -2 } },
    { label: "Dismiss as political attack", delta: { crimeRate: 4, stability: -5 } },
  ]},
  { title: "Refugee Integration Success Story", body: "A resettled family's small business becomes a local success story, drawing national attention.", choices: [
    { label: "Publicize it as a model integration program", delta: { happiness: 2, gdpGrowth: 0.0003 } },
    { label: "Quietly note it internally", delta: {} },
    { label: "Downplay it to avoid controversy", delta: { happiness: -1 } },
  ]},
  { title: "Domestic Vaccine Hesitancy Rise", body: "Public health officials report declining vaccination rates among children, raising outbreak risk.", choices: [
    { label: "Launch a national awareness campaign", delta: { treasury: -3e6, happiness: 1 } },
    { label: "Require vaccination for school enrollment", delta: { stability: -2, happiness: -1 } },
    { label: "No action", delta: { stability: -1 } },
  ]},
  { title: "Rural Depopulation Accelerates", body: "Several mountain villages report their school and only shop closing as residents move to cities.", choices: [
    { label: "Rural revitalization fund", delta: { treasury: -9e6, population: 800, happiness: 2 } },
    { label: "Subsidize essential rural services only", delta: { treasury: -3e6, happiness: 1 } },
    { label: "Let market forces decide", delta: { population: -1500, happiness: -1 } },
  ]},

  // ---- Diplomacy events: the real fault lines of Slovenian foreign policy ----
  { title: "Piran Bay Arbitration Flares Up Again", body: "Croatian fishing boats, escorted by police vessels, cross the arbitration line in the Bay of Piran. Slovenia's 2017 arbitration award remains unrecognized by Zagreb, and fishermen on both sides demand action.", choices: [
    { label: "Escort our fishermen with police boats — enforce the award", delta: { stability: 2, relations: { CRO: -8 }, tension: { CRO: 12 } } },
    { label: "File charges quietly, seek EU mediation", delta: { treasury: -2e6, relations: { CRO: -2 }, euNato: 2 } },
    { label: "Propose a joint fisheries commission with Zagreb", delta: { stability: -1, relations: { CRO: 6 } } },
  ]},
  { title: "Krško Nuclear Waste Standoff", body: "The NEK nuclear plant at Krško is co-owned 50/50 with Croatia, but the long-delayed question of where to store spent fuel is back on the table — and Zagreb is stalling on its half of the cost.", choices: [
    { label: "Build the dry storage alone, bill Croatia later", delta: { treasury: -60e6, relations: { CRO: -5 } } },
    { label: "Suspend Croatia's power share until they pay", delta: { relations: { CRO: -12 }, tension: { CRO: 10 }, stability: 1 } },
    { label: "Negotiate a joint storage fund at a bilateral summit", delta: { treasury: -25e6, relations: { CRO: 8 } } },
  ]},
  { title: "Ljubljanska Banka Claims Resurface", body: "Croatian savers' decades-old foreign-currency deposit claims against the former Ljubljanska banka resurface in an EU court filing, souring headlines in both capitals.", choices: [
    { label: "Settle the remaining claims", delta: { treasury: -45e6, relations: { CRO: 10 }, euNato: 2 } },
    { label: "Fight it in court", delta: { treasury: -5e6, relations: { CRO: -6 } } },
    { label: "Link it to Croatia recognizing the Piran arbitration", delta: { relations: { CRO: -4 }, tension: { CRO: 5 }, stability: 1 } },
  ]},
  { title: "Koper vs Trieste: The Port War", body: "Italy announces major state investment in the Port of Trieste, directly targeting cargo that today flows through Koper. Luka Koper's management asks for a matching national commitment.", choices: [
    { label: "Fund Koper's second rail track and new pier", delta: { treasury: -120e6, gdpGrowth: 0.0012, relations: { ITA: -3 } } },
    { label: "Propose a joint Adriatic logistics zone with Italy", delta: { relations: { ITA: 8 }, gdpGrowth: 0.0004 } },
    { label: "Do nothing — let the market sort it out", delta: { gdpGrowth: -0.0006, happiness: -1 } },
  ]},
  { title: "Slovene Minority Schools in Italy Underfunded", body: "Slovene-language schools in Trieste and Gorizia report funding cuts from Rome. Minority organizations ask Ljubljana to intervene.", choices: [
    { label: "Fund the schools directly from our budget", delta: { treasury: -8e6, happiness: 2, relations: { ITA: 2 } } },
    { label: "Raise it formally with Rome and the EU", delta: { relations: { ITA: -3 }, euNato: 1 } },
    { label: "Stay out of Italian domestic affairs", delta: { happiness: -2 } },
  ]},
  { title: "Austria Extends Border Checks at Karavanke", body: "Vienna again extends 'temporary' Schengen border controls at the Karavanke tunnel, citing migration — trucks queue for hours and Gorenjska commuters are furious.", choices: [
    { label: "File a formal complaint with the European Commission", delta: { relations: { AUT: -4 }, euNato: 2 } },
    { label: "Negotiate joint patrols to make checks unnecessary", delta: { treasury: -4e6, relations: { AUT: 6 } } },
    { label: "Mirror the controls on our side", delta: { relations: { AUT: -8 }, tension: { AUT: 6 }, gdpGrowth: -0.0004, stability: 1 } },
  ]},
  { title: "Carinthian Slovenes Seek Support", body: "The Slovene minority in Austrian Carinthia requests cultural funding and a stronger Slovenian voice on bilingual signage disputes.", choices: [
    { label: "Quiet cultural diplomacy and funding", delta: { treasury: -3e6, relations: { AUT: 3 }, happiness: 1 } },
    { label: "Loud public pressure on Vienna", delta: { relations: { AUT: -6 }, stability: 1 } },
    { label: "Decline — avoid friction", delta: { happiness: -1 } },
  ]},
  { title: "Hungarian Media Group Buys Slovenian Outlets", body: "A media conglomerate close to Budapest's government acquires several Slovenian regional TV stations and portals, raising concerns about foreign political influence.", choices: [
    { label: "Block the acquisition on media-plurality grounds", delta: { relations: { HUN: -8 }, stability: 2 } },
    { label: "Allow it but tighten transparency rules", delta: { relations: { HUN: -2 }, stability: -1 } },
    { label: "Wave it through", delta: { relations: { HUN: 5 }, stability: -3 } },
  ]},
  { title: "Budapest Proposes Energy Corridor", body: "Hungary proposes a joint gas-and-electricity interconnector through Prekmurje, promising cheaper energy for eastern Slovenia — with strings attached on route control.", choices: [
    { label: "Sign it — cheaper energy wins", delta: { treasury: -30e6, gdpGrowth: 0.0006, relations: { HUN: 8 } } },
    { label: "Counter-propose EU-supervised terms", delta: { relations: { HUN: 2 }, euNato: 2 } },
    { label: "Reject over sovereignty concerns", delta: { relations: { HUN: -6 } } },
  ]},
  { title: "NATO Battlegroup Rotation Request", body: "NATO asks Slovenia to contribute a company to the enhanced forward presence in the Baltics. A visible alliance contribution — and a real cost.", choices: [
    { label: "Send the company", delta: { treasury: -18e6, manpower: -150, euNato: 6 } },
    { label: "Send trainers and medics only", delta: { treasury: -6e6, manpower: -40, euNato: 2 } },
    { label: "Decline this rotation", delta: { euNato: -5 } },
  ]},
  { title: "Western Balkans EU Enlargement Summit", body: "Slovenia is asked to host the next EU–Western Balkans summit on enlargement — Ljubljana's traditional foreign-policy niche since the Brdo-Brijuni Process.", choices: [
    { label: "Host it at Brdo Castle in full style", delta: { treasury: -12e6, euNato: 5, relations: { CRO: 3 }, happiness: 1 } },
    { label: "Co-host modestly with Croatia", delta: { treasury: -5e6, euNato: 2, relations: { CRO: 5 } } },
    { label: "Pass this year", delta: { euNato: -2 } },
  ]},
  { title: "Adriatic Ionian Pipeline Consultation", body: "Italy and Croatia invite Slovenia into a joint Adriatic energy security framework after instability in global gas markets.", choices: [
    { label: "Join as a full partner", delta: { treasury: -20e6, relations: { ITA: 5, CRO: 5 }, gdpGrowth: 0.0004 } },
    { label: "Observer status only", delta: { relations: { ITA: 1, CRO: 1 } } },
    { label: "Stay out", delta: { relations: { ITA: -2, CRO: -2 } } },
  ]},

  // ---- ECONOMIC CYCLE (RoN-style, with timed modifiers) ----
  { title: "Stock Market Rally", mood: "good", body: "The Ljubljana Stock Exchange is on a historic bull run and state holdings have appreciated sharply.", choices: [
    { label: "Cash in part of the state portfolio", delta: { treasury: 45e6 } },
    { label: "Hold and tax the gains", delta: { treasury: 25e6, stability: 1 } },
  ]},
  { title: "Economic Boom", mood: "good", requires: () => state.econ.stability >= 65, body: "Exports are surging and confidence is sky-high — economists are calling it a golden year for Slovenia.", choices: [
    { label: "Ride the wave", delta: { treasury: 60e6, addModifier: { key: "economic_growth", label: "Economic Growth", icon: svgIcon('trendup'), days: 365, fx: { growthBonus: 0.006, stabilityBonus: 0.005 } } } },
    { label: "Save the windfall for a rainy day", delta: { treasury: 100e6 } },
  ]},
  { title: "Monetary Policy Dilemma", body: "The treasury is under pressure and advisors float 'quantitative easing, Slovenian edition' — simply printing the shortfall.", choices: [
    { label: "Print money", delta: { treasury: 150e6, hyperinflationRisk: 0.15 } },
    { label: "Hold the line", delta: {} },
  ]},
  { title: "IMF Intervention", requires: () => state.econ.treasury < 200e6, body: "With reserves nearly gone, the International Monetary Fund offers an emergency package — with the usual strings attached.", choices: [
    { label: "Accept the package", delta: { treasury: 500e6, addModifier: { key: "economic_depression", label: "Economic Depression (IMF austerity)", icon: svgIcon('trenddown'), days: 730, fx: { growthBonus: -0.006, stabilityBonus: -0.008 } } } },
    { label: "Refuse — we solve this ourselves", delta: {} },
  ]},
  { title: "Harsh Economic Measures", requires: () => hasModifier("hyperinflation"), weight: 3, body: "Economists insist that only brutal fiscal discipline — spending freezes, a currency board, emergency taxes — can kill the hyperinflation quickly.", choices: [
    { label: "Enact the measures", delta: { addModifier: { key: "harsh_measures", label: "Harsh Economic Measures", icon: svgIcon('medic'), days: 180, fx: { growthBonus: -0.004, stabilityBonus: -0.006 } } } },
    { label: "Wait it out", delta: {} },
  ]},

  // ---- WORKERS & PROTESTS (chained) ----
  { title: "Strikers Make Demands", mood: "bad", body: "Industrial unions have downed tools nationwide, demanding wage indexation and shorter hours.", choices: [
    { label: "Meet their demands", delta: { treasury: -30e6, stability: -1 } },
    { label: "Refuse", delta: { addModifier: { key: "workers_strike", label: "Workers' Strike", icon: svgIcon('fist'), days: 180, fx: { growthBonus: -0.004, factoryOutputMult: -0.25 } } } },
    { label: "Repress the strikes", delta: { stability: -3, warExhaustion: 0.5, corruption: 1, riskEvent: "Mass Demonstrations", riskChance: 0.45 } },
  ]},
  { title: "Mass Demonstrations", requires: () => false, body: "Hundreds of thousands are on the streets of Ljubljana and Maribor. The government's authority itself is being questioned.", choices: [
    { label: "Concede to the movement", delta: { stability: -2, addModifier: { key: "disjointed_government", label: "Disjointed Government", icon: svgIcon('house'), days: 1000, fx: { taxIncomeMult: -0.08, growthBonus: -0.002 } } } },
    { label: "Refuse to budge", delta: { addModifier: { key: "mass_demonstrations", label: "Mass Demonstrations", icon: svgIcon('megaphone'), days: 365, fx: { stabilityBonus: -0.03, growthBonus: -0.003 } } } },
    { label: "Bring in the military", delta: { stability: -1, riskEvent: "Violent Confrontations", riskChance: 0.55 } },
  ]},
  { title: "Violent Confrontations", requires: () => false, body: "Soldiers and demonstrators are face to face and stones are already flying. One order decides how this ends.", choices: [
    { label: "Stand down", delta: { addModifier: { key: "mass_demonstrations", label: "Mass Demonstrations", icon: svgIcon('megaphone'), days: 440, fx: { stabilityBonus: -0.03, growthBonus: -0.003 } } } },
    { label: "Crack down", delta: { stability: -8, warExhaustion: 1, corruption: 3 } },
  ]},

  // ---- INVESTMENT OPPORTUNITIES ----
  { title: "A New Researcher", mood: "good", body: "A world-renowned Slovenian scientist is willing to return from MIT and lead a national lab — for a serious budget.", choices: [
    { label: "Hire them", delta: { treasury: -8e6, addModifier: { key: "star_researcher", label: "Star Researcher", icon: svgIcon('flask'), days: 365, fx: { researchRateMult: 0.25 } } } },
    { label: "Politely decline", delta: {} },
  ]},
  { title: "National Monument", body: "Architects propose a grand national monument on Ljubljana Castle hill to mark the country's independence.", choices: [
    { label: "Construct it", delta: { treasury: -45e6, stability: 5, addModifier: { key: "national_pride", label: "National Pride", icon: svgIcon('monument'), permanent: true, fx: { stabilityBonus: 0.004 } } } },
    { label: "Ignore the proposal", delta: {} },
  ]},
  { title: "Research Investment Required", body: "The national institute's flagship program has stalled — one funding injection away from a breakthrough.", choices: [
    { label: "Grant the funds", delta: { treasury: -12e6, research: 2000 } },
    { label: "Reject", delta: {} },
  ]},
  { title: "Military Parade", body: "The general staff proposes a parade for Statehood Day. Scale it as you see fit.", choices: [
    { label: "Grand parade", delta: { treasury: -20e6, stability: 4 } },
    { label: "Modest parade", delta: { treasury: -8e6, stability: 2 } },
    { label: "Symbolic ceremony", delta: { treasury: -2e6, stability: 1 } },
    { label: "Skip it", delta: { stability: -1 } },
  ]},

  // ---- WAR EVENTS (only fire while at war) ----
  { title: "Military Research Breakthrough", war: true, mood: "good", body: "Battlefield experience is feeding straight back into the labs — engineers report a leap in applied military technology.", choices: [
    { label: "Excellent", delta: { research: 2500 } },
  ]},
  { title: "The Last Stand", war: true, mood: "good", body: "A hopelessly outnumbered company held its position to the last round. The nation is electrified by their stand.", choices: [
    { label: "Honor them", delta: { manpower: 1500, stability: 5, warExhaustion: -1.5 } },
  ]},
  { title: "Anti-War Protests", war: true, mood: "bad", body: "War-weary crowds fill the squares demanding an immediate end to the fighting.", choices: [
    { label: "Let them march", delta: { stability: -5 } },
    { label: "Suppress the protests", delta: { stability: -2, corruption: 2, riskEvent: "Mass Demonstrations", riskChance: 0.3 } },
  ]},
  { title: "Wave of National Fervor", war: true, mood: "good", body: "Recruitment offices are overwhelmed — volunteers are queueing around the block to defend the homeland.", choices: [
    { label: "Enlist them", delta: { manpower: 900, warExhaustion: -0.5 } },
  ]},
  { title: "Deserters", war: true, mood: "bad", body: "Whole platoons have abandoned their posts overnight and slipped across the border.", choices: [
    { label: "A dark day", delta: { manpower: -1200, warExhaustion: 0.5 } },
  ]},
  { title: "Skills Shortage", war: true, mood: "bad", body: "Engineers, doctors and technicians are fleeing the war abroad. Industry is starting to feel their absence.", choices: [
    { label: "Acknowledge", delta: { addModifier: { key: "skills_shortage", label: "Skills Shortage", icon: svgIcon('toolbox'), permanent: true, fx: { growthBonus: -0.003, researchRateMult: -0.05 } } } },
  ]},
  { title: "Chronic Desertions", war: true, mood: "bad", body: "Desertion has become systemic. The general staff demands you either tolerate it or make an example.", choices: [
    { label: "Do nothing", delta: { addModifier: { key: "combat_fatigue", label: "Combat Fatigue", icon: svgIcon('wilt'), days: 730, fx: { unitAttackMult: -0.10 } } } },
    { label: "Set an example", delta: { warExhaustion: 1, stability: -5 } },
  ]},
  { title: "Widespread Mutinies", war: true, mood: "bad", body: "Several brigades refuse orders outright. The army is on the edge of falling apart.", choices: [
    { label: "Do nothing", delta: { addModifier: { key: "military_disarray", label: "Military Disarray", icon: svgIcon('warning'), days: 365, fx: { unitAttackMult: -0.15, unitDefenseMult: -0.10 } } } },
    { label: "Increase soldiers' wages", delta: { treasury: -60e6 } },
    { label: "Reform the command structure", delta: { addModifier: { key: "military_reorg", label: "Military Reorganization", icon: svgIcon('wrench'), days: 90, fx: { unitAttackMult: -0.05, upkeepMult: 0.2 } } } },
  ]},
];

let usedEventTitles = new Set();

// ---- Stability-weighted event selection ----
// An event's "mood" (good/bad/neutral) is inferred from its choice deltas
// unless tagged explicitly. Low stability makes bad events much more likely;
// stability above ~70 favors good ones, and very high stability (85+) makes
// the best events more common still. War events only fire during a war —
// and the nastier ones mostly when stability is already low.
function choiceDeltaScore(delta) {
  if (!delta) return 0;
  let s = 0;
  s += (delta.stability || 0);
  s += (delta.happiness || 0) * 0.5;
  s += (delta.treasury || 0) / 1e7 * 0.5;
  s += (delta.gdpGrowth || 0) * 2500;
  s += (delta.manpower || 0) / 400;
  s -= (delta.crimeRate || 0) * 0.5;
  s -= (delta.warExhaustion || 0);
  s -= (delta.corruption || 0) * 0.3;
  if (delta.addModifier && delta.addModifier.fx) {
    const fx = delta.addModifier.fx;
    s += (fx.growthBonus || 0) * 2500 + (fx.stabilityBonus || 0) * 300;
  }
  return s;
}

function eventMood(ev) {
  if (ev.mood) return ev.mood;
  let sum = 0, n = 0;
  for (const c of ev.choices) {
    const d = c.chance !== undefined
      ? choiceDeltaScore(c.successDelta) * c.chance + choiceDeltaScore(c.failDelta) * (1 - c.chance)
      : choiceDeltaScore(c.delta);
    sum += d; n++;
  }
  const avg = n ? sum / n : 0;
  return avg > 1 ? "good" : avg < -1 ? "bad" : "neutral";
}

function eventWeight(ev) {
  const stab = state.econ.stability;
  const war = typeof atWarAny === "function" && atWarAny();
  if (ev.war && !war) return 0;                      // war events need a war
  if (ev.requires && !ev.requires()) return 0;       // conditional events
  let w = ev.weight || 1;
  const mood = eventMood(ev);
  if (mood === "bad") w *= clamp(1 + (60 - stab) / 35, 0.25, 3.2);
  if (mood === "good") {
    w *= clamp(1 + (stab - 60) / 35, 0.3, 2.2);
    if (stab >= 85) w *= 1.6;                        // very stable → very good times
  }
  if (ev.war && mood === "bad") w *= clamp(1 + (55 - stab) / 30, 0.5, 3);
  return w;
}

function pickRandomEvent() {
  let pool = EVENT_POOL.filter(e => !usedEventTitles.has(e.title) && eventWeight(e) > 0);
  if (pool.length === 0) { usedEventTitles.clear(); pool = EVENT_POOL.filter(e => eventWeight(e) > 0); }
  if (pool.length === 0) return null;
  const weights = pool.map(eventWeight);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let ev = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { ev = pool[i]; break; } }
  usedEventTitles.add(ev.title);
  return ev;
}

// Queue a specific event by title (used for chained events like
// Mass Demonstrations → Violent Confrontations).
function triggerEventByTitle(title, delayNote) {
  const ev = EVENT_POOL.find(e => e.title === title);
  if (!ev) return;
  state.pendingDecisions.push({
    id: state.infraSeq + Math.random(),
    ev,
    createdDate: new Date(state.date),
    deadlineDate: new Date(state.date.getTime() + (ev.deadlineDays || 10) * 86400000),
    expertsRevealed: false,
  });
  playSound("mail");
  renderPendingTray();
}

function triggerRandomEvent() {
  const ev = pickRandomEvent();
  if (!ev) return;
  const deadlineDays = ev.deadlineDays || 10;
  const decision = {
    id: state.infraSeq + Math.random(), // cheap unique id
    ev,
    createdDate: new Date(state.date),
    deadlineDate: new Date(state.date.getTime() + deadlineDays * 86400000),
    expertsRevealed: false,
  };
  state.pendingDecisions.push(decision);
  playSound("mail"); // new letter in the tray
  maybeShowNextDecision();
  renderPendingTray();
}

function tickPendingDecisions() {
  const expired = state.pendingDecisions.filter(d => state.date >= d.deadlineDate);
  if (!expired.length) return;
  state.pendingDecisions = state.pendingDecisions.filter(d => state.date < d.deadlineDate);
  expired.forEach(d => {
    const consequence = d.ev.expiredConsequence || { stability: -3, treasury: -2e6 };
    applyEventDelta(consequence);
    logEvent(`<b>${d.ev.title}</b>: expired without a decision <span style="color:#7c98a2">(${deltaPreviewHTML(consequence)})</span>`);
  });
  renderPendingTray();
  const modal = document.getElementById("eventModal");
  if (!modal.classList.contains("hidden") && currentDecision && expired.includes(currentDecision)) {
    modal.classList.add("hidden");
    currentDecision = null;
    if (prevSpeedBeforeEvent) state.paused = prevSpeedBeforeEvent.paused;
    refreshSpeedButtons();
    maybeShowNextDecision();
  }
}

// Resolve risky choices whose waiting period has elapsed: roll the dice now,
// apply the effects, and drop a success/failure report into the mail tray
// (reusing the pending-decision machinery so it shows up as a clickable ✉).
function tickPendingOutcomes() {
  if (!state.pendingOutcomes.length) return;
  const due = state.pendingOutcomes.filter(o => state.date >= o.resolveDate);
  if (!due.length) return;
  state.pendingOutcomes = state.pendingOutcomes.filter(o => state.date < o.resolveDate);
  due.forEach(o => {
    const success = Math.random() < o.choice.chance;
    const delta = success ? o.choice.successDelta : o.choice.failDelta;
    applyEventDelta(delta);
    logEvent(`<b>${o.ev.title}</b>: ${o.choice.label} — <b style="color:${success ? "#7fc97f" : "#e06c60"}">${success ? "succeeded" : "failed"}</b> <span style="color:#7c98a2">(${deltaPreviewHTML(delta)})</span>`);
    state.pendingDecisions.push({
      id: state.infraSeq + Math.random(),
      ev: {
        title: `${success ? "Success" : "Failure"} — Report: ${o.ev.title}`,
        body: `Your decision "${o.choice.label}" on "${o.ev.title}" has ${success ? "SUCCEEDED" : "FAILED"}. The effects have been applied.`,
        choices: [{ label: "Acknowledged", delta: {} }],
        expiredConsequence: {}, // reports expire harmlessly if ignored
      },
      createdDate: new Date(state.date),
      deadlineDate: new Date(state.date.getTime() + 30 * 86400000),
      expertsRevealed: false,
    });
    playSound("mail");
  });
  renderPendingTray();
}

function applyEventDelta(delta) {
  const econ = state.econ;
  if (delta.treasury) econ.treasury += delta.treasury;
  if (delta.stability) econ.stability = clamp(econ.stability + delta.stability, 0, 100);
  if (delta.research) econ.research += delta.research;
  if (delta.gdpGrowth) econ.eventGrowthBonus += delta.gdpGrowth;
  if (delta.manpower) econ.manpowerActive = Math.max(0, Math.min(econ.manpowerActiveCap, econ.manpowerActive + delta.manpower));
  if (delta.population) econ.population = Math.max(0, Math.round(econ.population + delta.population));
  if (delta.crimeRate) econ.crimeRate = clamp(econ.crimeRate + delta.crimeRate, 0, 100);
  if (delta.unemploymentRate) econ.unemploymentRate = clamp(econ.unemploymentRate + delta.unemploymentRate, 0, 40);
  if (delta.happiness) econ.overallHappiness = clamp(econ.overallHappiness + delta.happiness, 0, 100);
  if (delta.fertilityRate) econ.fertilityRate = clamp(econ.fertilityRate + delta.fertilityRate, 0.5, 3);
  if (delta.relations) for (const id in delta.relations) changeRelation(id, delta.relations[id]);
  if (delta.tension) for (const id in delta.tension) {
    const n = natState(id);
    n.tension = clamp(n.tension + delta.tension[id], 0, 100);
  }
  if (delta.euNato) state.diplomacy.euNatoStanding = clamp(state.diplomacy.euNatoStanding + delta.euNato, 0, 100);
  if (delta.warExhaustion) econ.warExhaustion = clamp((econ.warExhaustion || 0) + delta.warExhaustion, 0, 100);
  if (delta.corruption) econ.corruption = clamp((econ.corruption || 25) + delta.corruption, 0, 100);
  if (delta.hyperinflationRisk) state.hyperinflationRisk = clamp((state.hyperinflationRisk || 0) + delta.hyperinflationRisk, 0, 1);
  if (delta.addModifier) addModifier(delta.addModifier);
  if (delta.removeModifier) removeModifier(delta.removeModifier);
  if (delta.triggerEvent) triggerEventByTitle(delta.triggerEvent);
  // "risk" chains: a chance that a follow-up event fires
  if (delta.riskEvent && Math.random() < (delta.riskChance != null ? delta.riskChance : 0.5)) triggerEventByTitle(delta.riskEvent);
  if (delta.researchBoost) {
    // Temporary research-speed multiplier (stacks additively, takes the longer duration).
    state.researchBoost = {
      mult: (state.researchBoost.mult || 0) + delta.researchBoost.mult,
      daysLeft: Math.max(state.researchBoost.daysLeft || 0, delta.researchBoost.days),
    };
  }
  if (delta.relations || delta.tension || delta.euNato) renderDiplomacyTab();
}

function deltaPreviewHTML(delta) {
  const parts = [];
  if (delta.treasury) parts.push(`<span class="${delta.treasury >= 0 ? "pos" : "neg"}">${delta.treasury >= 0 ? "+" : ""}${fmtEUR(delta.treasury)} Treasury</span>`);
  if (delta.stability) parts.push(`<span class="${delta.stability >= 0 ? "pos" : "neg"}">${delta.stability >= 0 ? "+" : ""}${delta.stability} Stability</span>`);
  if (delta.research) parts.push(`<span class="pos">+${fmtNum(delta.research)} Research</span>`);
  if (delta.gdpGrowth) parts.push(`<span class="pos">+${(delta.gdpGrowth * 100).toFixed(2)}%/yr Growth (permanent)</span>`);
  if (delta.manpower) parts.push(`<span class="${delta.manpower >= 0 ? "pos" : "neg"}">${delta.manpower >= 0 ? "+" : ""}${fmtNum(delta.manpower)} Manpower</span>`);
  if (delta.population) parts.push(`<span class="${delta.population >= 0 ? "pos" : "neg"}">${delta.population >= 0 ? "+" : ""}${fmtNum(delta.population)} Population</span>`);
  if (delta.crimeRate) parts.push(`<span class="${delta.crimeRate <= 0 ? "pos" : "neg"}">${delta.crimeRate >= 0 ? "+" : ""}${delta.crimeRate} Crime Index</span>`);
  if (delta.unemploymentRate) parts.push(`<span class="${delta.unemploymentRate <= 0 ? "pos" : "neg"}">${delta.unemploymentRate >= 0 ? "+" : ""}${delta.unemploymentRate}% Unemployment</span>`);
  if (delta.happiness) parts.push(`<span class="${delta.happiness >= 0 ? "pos" : "neg"}">${delta.happiness >= 0 ? "+" : ""}${delta.happiness} Happiness</span>`);
  if (delta.fertilityRate) parts.push(`<span class="${delta.fertilityRate >= 0 ? "pos" : "neg"}">${delta.fertilityRate >= 0 ? "+" : ""}${delta.fertilityRate.toFixed(2)} Fertility</span>`);
  if (delta.relations) for (const id in delta.relations) {
    const v = delta.relations[id];
    parts.push(`<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v} ${NEIGHBOR_NATIONS[id].flag} ${NEIGHBOR_NATIONS[id].name}</span>`);
  }
  if (delta.tension) for (const id in delta.tension) {
    const v = delta.tension[id];
    parts.push(`<span class="${v <= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v} Tension (${NEIGHBOR_NATIONS[id].name})</span>`);
  }
  if (delta.euNato) parts.push(`<span class="${delta.euNato >= 0 ? "pos" : "neg"}">${delta.euNato >= 0 ? "+" : ""}${delta.euNato} EU/NATO Standing</span>`);
  if (delta.researchBoost) parts.push(`<span class="pos">+${(delta.researchBoost.mult * 100).toFixed(0)}% research speed for ${delta.researchBoost.days}d</span>`);
  if (delta.warExhaustion) parts.push(`<span class="${delta.warExhaustion <= 0 ? "pos" : "neg"}">${delta.warExhaustion >= 0 ? "+" : ""}${delta.warExhaustion} War Exhaustion</span>`);
  if (delta.corruption) parts.push(`<span class="${delta.corruption <= 0 ? "pos" : "neg"}">${delta.corruption >= 0 ? "+" : ""}${delta.corruption} Corruption</span>`);
  if (delta.hyperinflationRisk) parts.push(`<span class="neg">+${Math.round(delta.hyperinflationRisk * 100)}% hyperinflation risk</span>`);
  if (delta.addModifier) parts.push(`<span class="${((delta.addModifier.fx || {}).growthBonus || 0) + ((delta.addModifier.fx || {}).stabilityBonus || 0) >= 0 ? "pos" : "neg"}">${delta.addModifier.icon || svgIcon('gauge')} ${delta.addModifier.label} ${delta.addModifier.permanent ? "(permanent)" : `(${delta.addModifier.days}d)`}</span>`);
  if (delta.removeModifier) parts.push(`<span class="pos">removes ${delta.removeModifier.replace(/_/g, " ")}</span>`);
  if (delta.riskEvent) parts.push(`<span class="neg">${svgIcon('warning')} risks: ${delta.riskEvent}</span>`);
  if (delta.triggerEvent) parts.push(`<span class="neg">→ leads to: ${delta.triggerEvent}</span>`);
  if (!parts.length) return `<span class="neutral">No direct effect</span>`;
  return parts.join(" &nbsp;·&nbsp; ");
}

function logEvent(text) {
  state.eventLog.unshift({ text, date: new Date(state.date) });
  if (state.eventLog.length > 60) state.eventLog.pop();
  renderEventLog();
}
