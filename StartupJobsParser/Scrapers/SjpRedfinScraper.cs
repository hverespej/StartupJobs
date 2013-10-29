﻿using HtmlAgilityPack;
using System;
using System.Collections.Generic;
using System.Net;

namespace StartupJobsParser
{
    public class SjpRedfinScraper : SjpJobviteScraperBase
    {
        private static readonly Uri _publicUri = new Uri("http://www.redfin.com/about/jobs");

        public override string CompanyName { get { return "Redfin"; } }
        protected override string JobviteCompanyId { get { return "qf49Vfw7"; } }
        public override Uri PublicUri { get { return _publicUri; } }

        public SjpRedfinScraper(SjpScraperParams scraperParams)
            : base(scraperParams)
        {
        }

        protected override IEnumerable<JobDescription> GetJds(Uri uri)
        {
            HtmlDocument doc = SjpUtils.GetHtmlDoc(uri);
            foreach (HtmlNode jdUriNode in doc.DocumentNode.SelectNodes("//a[contains(@href, '/open-jobs?')]"))
            {
                // Get the jobvite job ID from the link
                Uri tmpUri = new Uri(jdUriNode.Attributes["href"].Value);
                string jobId = tmpUri.Query.Split('=')[1];
                yield return GetRedfinJd(GetItemUri(WebUtility.UrlEncode(jobId)));
            }
        }

        private JobDescription GetRedfinJd(Uri jdUri)
        {
            HtmlDocument doc = SjpUtils.GetHtmlDoc(jdUri);

            HtmlNode titleNode = doc.DocumentNode.SelectSingleNode("//h1");
            HtmlNode locationNode = doc.DocumentNode.SelectSingleNode("//h2");
            HtmlNode descriptionNode = doc.DocumentNode.SelectSingleNode("//div[@class='jobDesc']");

            return new JobDescription()
            {
                SourceUri = TryCreateTrackedLink(PublicTaggedUri),
                Company = CompanyName,
                Title = SjpUtils.GetCleanTextFromHtml(titleNode),
                Location = SjpUtils.GetCleanTextFromHtml(locationNode),
                FullTextDescription = SjpUtils.GetCleanTextFromHtml(descriptionNode),
                FullHtmlDescription = descriptionNode.InnerHtml
            };
        }
    }
}