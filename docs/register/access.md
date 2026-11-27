# Company register data access

Reviewed on 27 November 2026.

Company records support manual entry, uploaded extracts, structured CSV or JSON imports and authenticated provider APIs. Use the **Register** section of a company to search a provider, select the register identity and review its fields. See [Data providers and registers](../integrations/data-providers-and-registers.md).

## German register material

The joint register portal provides individual access to register information and filed documents. Its terms restrict systematic retrieval for building or updating parallel registers. Use the portal interactively for an individual extract. Carraway uses a licensed API for automated retrieval. [Register portal information and terms](https://www.handelsregister.de/rp_web/information/welcome.xhtml) · [Section 9 HGB](https://www.gesetze-im-internet.de/hgb/__9.html)

The applicable conditions depend on the portal, document and service requested. Consult the portal's current information before ordering an official copy or accessing deposited accounts. [Register portal guide](https://www.handelsregister.de/rp_web/div/info-lang/EN_Registerportal.pdf) · [Company Register](https://www.unternehmensregister.de/)

Implementing Regulation (EU) 2023/138 includes company information among high-value datasets. Check the publishing authority's access arrangements for the particular dataset. [Regulation (EU) 2023/138](https://eur-lex.europa.eu/eli/reg_impl/2023/138/oj)

## Sources and monitoring

North Data provides structured register information, publications and financial indicators according to the installation's subscription. Companies House provides UK company profiles, officers and filing history. Search and retrieval use the respective documented APIs. The public website links beside a value provide attribution.

An administrator can enable monitoring on individual companies. A worker schedule and a previously selected company reference for the configured register provider are required. The worker shares the installation's request budget with interactive use. New source entries and announcements appear in the register history and notifications. CRM field updates require review.

Company officers are natural persons. Limit stored information to names and relevant functions, document the purpose and lawful basis, and apply the installation's retention and deletion procedures.
