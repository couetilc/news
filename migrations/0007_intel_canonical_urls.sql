-- Verified Intel migration aliases: listing identity or article content matches.
-- Evidence and match methods: experiments/intel-verified-url-mapping.json.
-- Preserve id/guid/read history and original publish timestamps.
-- A pre-existing canonical URL is left untouched for explicit review.
UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/wireless/intel-5g-network-bridges-digital-divide.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8719' AND url = 'https://newsroom.intel.com/5g-wireless/intel-5g-network-bridges-digital-divide'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/wireless/intel-5g-network-bridges-digital-divide.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/computex-2026-an-intelligent-world-built-on-silicon.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8680' AND url = 'https://newsroom.intel.com/artificial-intelligence/computex-2026-an-intelligent-world-built-on-silicon'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/computex-2026-an-intelligent-world-built-on-silicon.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/data-center/intel-puts-agentic-ai-xeon-6-networking-ai-systems.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8598' AND url = 'https://newsroom.intel.com/data-center/intel-puts-agentic-ai-xeon-6-networking-ai-systems'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/data-center/intel-puts-agentic-ai-xeon-6-networking-ai-systems.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/meet-the-inventor-of-emib.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8631' AND url = 'https://newsroom.intel.com/intel-foundry/meet-the-inventor-of-emib'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/meet-the-inventor-of-emib.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-arc-g-series-processors-set-a-new-standard-for-handheld-pc-gaming.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8626' AND url = 'https://newsroom.intel.com/client-computing/intel-arc-g-series-processors-set-a-new-standard-for-handheld-pc-gaming'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-arc-g-series-processors-set-a-new-standard-for-handheld-pc-gaming.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intels-2025-outstanding-researcher-awards-honor-10-academic-innovators.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8561' AND url = 'https://newsroom.intel.com/corporate/intels-2025-outstanding-researcher-awards-honor-10-academic-innovators'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intels-2025-outstanding-researcher-awards-honor-10-academic-innovators.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/ceo-letter-2025-26-intel-corporate-responsibility-report.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8839' AND url = 'https://newsroom.intel.com/corporate/ceo-letter-2025-26-intel-corporate-responsibility-report'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/ceo-letter-2025-26-intel-corporate-responsibility-report.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-advances-growth-in-ai-era-2025-2026-csr-report.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8808' AND url = 'https://newsroom.intel.com/corporate/intel-advances-growth-in-ai-era-2025-2026-csr-report'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-advances-growth-in-ai-era-2025-2026-csr-report.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-foundry-details-process-milestones-future-innovation-at-vlsi-symposium.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8806' AND url = 'https://newsroom.intel.com/intel-foundry/intel-foundry-details-process-milestones-future-innovation-at-vlsi-symposium'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-foundry-details-process-milestones-future-innovation-at-vlsi-symposium.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-leadership-appointment-at-intel-foundry-to-accelerate-development-and-manufacturing.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8851' AND url = 'https://newsroom.intel.com/corporate/intel-announces-leadership-appointment-at-intel-foundry-to-accelerate-development-and-manufacturing'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-leadership-appointment-at-intel-foundry-to-accelerate-development-and-manufacturing.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/america-250-intel-is-advancing-us-innovation.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8885' AND url = 'https://newsroom.intel.com/corporate/america-250-intel-is-advancing-us-innovation'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/america-250-intel-is-advancing-us-innovation.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/three-ways-intel-msi-co-engineered-worlds-first-arc-g3-handheld.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8860' AND url = 'https://newsroom.intel.com/client-computing/three-ways-intel-msi-co-engineered-worlds-first-arc-g3-handheld'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/three-ways-intel-msi-co-engineered-worlds-first-arc-g3-handheld.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-to-report-second-quarter-2026-financial-results.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8891' AND url = 'https://newsroom.intel.com/corporate/intel-to-report-second-quarter-2026-financial-results'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-to-report-second-quarter-2026-financial-results.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-invests-5-billion-euro-to-expand-manufacturing-in-europe.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8928' AND url = 'https://newsroom.intel.com/intel-foundry/intel-invests-5-billion-euro-to-expand-manufacturing-in-europe'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-invests-5-billion-euro-to-expand-manufacturing-in-europe.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-google-cloud-announce-collaboration-to-accelerate-intel-ai-enabled-enterprise-transformation.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8994' AND url = 'https://newsroom.intel.com/artificial-intelligence/intel-google-cloud-announce-collaboration-to-accelerate-intel-ai-enabled-enterprise-transformation'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-google-cloud-announce-collaboration-to-accelerate-intel-ai-enabled-enterprise-transformation.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-powered-medical-exoskeleton-helps-patients-get-back-on-their-feet.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8999' AND url = 'https://newsroom.intel.com/client-computing/intel-powered-medical-exoskeleton-helps-patients-get-back-on-their-feet'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-powered-medical-exoskeleton-helps-patients-get-back-on-their-feet.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-and-lens-technology-collaborate-to-enable-advanced-semiconductor-packaging-for-the-ai-era.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9085' AND url = 'https://newsroom.intel.com/new-technologies/intel-and-lens-technology-collaborate-to-enable-advanced-semiconductor-packaging-for-the-ai-era'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-and-lens-technology-collaborate-to-enable-advanced-semiconductor-packaging-for-the-ai-era.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-reports-second-quarter-2026-financial-results.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9068' AND url = 'https://newsroom.intel.com/corporate/intel-reports-second-quarter-2026-financial-results'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-reports-second-quarter-2026-financial-results.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/intel-foundry/intel-completes-ramp-c-program-accelerating-momentum-for-secure-enclave.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9015' AND url = 'https://newsroom.intel.com/intel-foundry/intel-completes-ramp-c-program-accelerating-momentum-for-secure-enclave'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/intel-foundry/intel-completes-ramp-c-program-accelerating-momentum-for-secure-enclave.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/intel-foundry/intels-us-advanced-packaging-enables-next-generation-ai-semiconductors.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9052' AND url = 'https://newsroom.intel.com/intel-foundry/intels-us-advanced-packaging-enables-next-generation-ai-semiconductors'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/intel-foundry/intels-us-advanced-packaging-enables-next-generation-ai-semiconductors.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/creating-pathways-to-semiconductor-careers-intel-launches-sepp.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9141' AND url = 'https://newsroom.intel.com/corporate/creating-pathways-to-semiconductor-careers-intel-launches-sepp'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/creating-pathways-to-semiconductor-careers-intel-launches-sepp.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-leadership-appointment-to-strengthen-customer-engagement-and-accelerate-growth.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9148' AND url = 'https://newsroom.intel.com/corporate/intel-announces-leadership-appointment-to-strengthen-customer-engagement-and-accelerate-growth'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-leadership-appointment-to-strengthen-customer-engagement-and-accelerate-growth.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-gamer-days-2026-kicking-off-with-aaa-gaming-bundle-partnerships.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9143' AND url = 'https://newsroom.intel.com/client-computing/intel-gamer-days-2026-kicking-off-with-aaa-gaming-bundle-partnerships'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-gamer-days-2026-kicking-off-with-aaa-gaming-bundle-partnerships.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-proposed-15-billion-common-stock-offering.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9162' AND url = 'https://newsroom.intel.com/corporate/intel-announces-proposed-15-billion-common-stock-offering'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-proposed-15-billion-common-stock-offering.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-upsize-and-pricing-of-20-billion-common-stock-offering.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9169' AND url = 'https://newsroom.intel.com/corporate/intel-announces-upsize-and-pricing-of-20-billion-common-stock-offering'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-announces-upsize-and-pricing-of-20-billion-common-stock-offering.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-corporation-to-participate-in-upcoming-investor-conference-august-2026.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9224' AND url = 'https://newsroom.intel.com/corporate/intel-corporation-to-participate-in-upcoming-investor-conference-august-2026'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/corporate/intel-corporation-to-participate-in-upcoming-investor-conference-august-2026.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/6-in-10-leaders-bet-big-on-robots-only-4-in-10-are-ready.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9107' AND url = 'https://newsroom.intel.com/artificial-intelligence/6-in-10-leaders-bet-big-on-robots-only-4-in-10-are-ready'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/6-in-10-leaders-bet-big-on-robots-only-4-in-10-are-ready.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-outlines-architectures-for-agentic-ai-at-hot-chips-2026.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9160' AND url = 'https://newsroom.intel.com/client-computing/intel-outlines-architectures-for-agentic-ai-at-hot-chips-2026'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-outlines-architectures-for-agentic-ai-at-hot-chips-2026.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-at-ai-infra-summit-2026.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9283' AND url = 'https://newsroom.intel.com/artificial-intelligence/intel-at-ai-infra-summit-2026'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-at-ai-infra-summit-2026.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-announces-new-ai-innovations-at-computex.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8677' AND url = 'https://newsroom.intel.com/artificial-intelligence/intel-announces-new-ai-innovations-at-computex'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/artificial-intelligence/intel-announces-new-ai-innovations-at-computex.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/customers-choose-intel-for-edge-devices.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8600' AND url = 'https://newsroom.intel.com/client-computing/customers-choose-intel-for-edge-devices'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/customers-choose-intel-for-edge-devices.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/postcard-from-computex-2026-new-intel-core-series-3-laptops-for-everyday-creation-and-all-day-productivity.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8769' AND url = 'https://newsroom.intel.com/client-computing/postcard-from-computex-2026-new-intel-core-series-3-laptops-for-creation-productivity'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/postcard-from-computex-2026-new-intel-core-series-3-laptops-for-everyday-creation-and-all-day-productivity.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/data-center/intel-introduces-ethernet-e835-controllers-network-adapters.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=8602' AND url = 'https://newsroom.intel.com/data-center/intel-introduces-ethernet-e835-controllers-network-adapters'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/data-center/intel-introduces-ethernet-e835-controllers-network-adapters.html');

UPDATE items SET url = 'https://www.intel.com/content/www/us/en/newsroom/news/manufacturing/intel-and-fortinet-collaborate-to-advance-cybersecurity-innovation-and-strengthen-global-supply-chain-resilience.html'
WHERE source = 'intel' AND guid = 'https://newsroom.intel.com/?p=9038' AND url = 'https://newsroom.intel.com/manufacturing/intel-and-fortinet-collaborate-to-advance-cybersecurity-innovation-and-strengthen-global-supply-chain-resilience'
  AND NOT EXISTS (SELECT 1 FROM items AS other WHERE other.source = 'intel' AND other.url = 'https://www.intel.com/content/www/us/en/newsroom/news/manufacturing/intel-and-fortinet-collaborate-to-advance-cybersecurity-innovation-and-strengthen-global-supply-chain-resilience.html');

