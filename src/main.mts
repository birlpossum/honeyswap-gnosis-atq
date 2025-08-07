import fetch from "node-fetch";
import { ContractTag, ITagService } from "atq-types";

// Honeyswap on Gnosis subgraph endpoint
// Official docs: https://wiki.1hive.org/developers/subgraphs/honeyswap
const SUBGRAPH_URL = "https://gateway-arbitrum.network.thegraph.com/api/[api-key]/deployments/id/QmYXRweJoBZrqSNBKU1gFKManVXRPUwByQ4JRbgCRPSZoy";

interface Token {
  id: string;
  symbol: string;
  name: string;
}

interface Pair {
  id: string;
  createdAtTimestamp: string;
  txCount: string;
  token0: Token;
  token1: Token;
}

interface GraphQLData {
  pairs: Pair[];
}

interface GraphQLResponse {
  data?: GraphQLData;
  errors?: { message: string }[]; // Assuming the API might return errors in this format
}
//defining headers for query
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

const GET_PAIRS_QUERY = `
  query GetPairs($cursor: BigInt!) {
    pairs(
      first: 1000
      orderBy: createdAtTimestamp
      orderDirection: asc
      where: { createdAtTimestamp_gt: $cursor }
    ) {
      id
      createdAtTimestamp
      txCount
      token0 { id symbol name }
      token1 { id symbol name }
    }
  }
`;

function isError(e: unknown): e is Error {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as Error).message === "string"
  );
}

const camelCaseToSpaced = (input: string): string => {
  // This regular expression finds all occurrences where a lowercase letter or a number is directly followed by an uppercase letter and inserts a space between them.
  return input.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
};

async function fetchData(
  subgraphUrl: string,
  lastTimestamp: number
): Promise<Pair[]> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: GET_PAIRS_QUERY,
      variables: { cursor: lastTimestamp },
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    result.errors.forEach((error) => {
      console.error(`GraphQL error: ${error.message}`);
    });
    throw new Error("GraphQL errors occurred: see logs for details.");
  }
  if (!result.data || !result.data.pairs) {
    throw new Error("No pairs data found.");
  }
  return result.data.pairs;
}

function prepareUrl(apiKey: string): string {
  // Only Gnosis (chainId 100) is supported in this repurposed version.
  return SUBGRAPH_URL.replace("[api-key]", encodeURIComponent(apiKey));
}

function truncateString(text: string, maxLength: number) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 3) + "..."; // Subtract 3 for the ellipsis
  }
  return text;
}
function containsHtmlOrMarkdown(text: string): boolean {
  // Enhanced HTML tag detection that requires at least one character inside the brackets
  if (/<[^>]+>/.test(text)) {
    return true;
  }
  return false;
}

// Local helper function used by returnTags
function transformPairsToTags(chainId: string, pairs: Pair[]): ContractTag[] {
  const validPairs: Pair[] = [];

  pairs.forEach((pair) => {
    // Check for HTML/Markdown and length in token symbols and names
    const token0Invalid =
      containsHtmlOrMarkdown(pair.token0.symbol) ||
      containsHtmlOrMarkdown(pair.token0.name) ||
      !pair.token0.symbol ||
      !pair.token0.name ||
      pair.token0.symbol.length > 20 ||
      pair.token0.name.length > 50;
    const token1Invalid =
      containsHtmlOrMarkdown(pair.token1.symbol) ||
      containsHtmlOrMarkdown(pair.token1.name) ||
      !pair.token1.symbol ||
      !pair.token1.name ||
      pair.token1.symbol.length > 20 ||
      pair.token1.name.length > 50;
    if (token0Invalid || token1Invalid) {
      // Optionally log or skip
      return;
    }
    validPairs.push(pair);
  });

  return validPairs.map((pair) => {
    const maxSymbolsLength = 45;
    const truncatedSymbolsText = truncateString(
      `${pair.token0.symbol}/${pair.token1.symbol}`,
      maxSymbolsLength
    );
    return {
      "Contract Address": `eip155:${chainId}:${pair.id}`,
      "Public Name Tag": `${truncatedSymbolsText} Pool`,
      "Project Name": "Honeyswap",
      "UI/Website Link": "https://honeyswap.org",
      "Public Note": `A Honeyswap liquidity pool contract for tokens: ${pair.token0.name} (symbol: ${pair.token0.symbol}), ${pair.token1.name} (symbol: ${pair.token1.symbol}).`,
    };
  });
}

//The main logic for this module
class TagService implements ITagService {
  // Using an arrow function for returnTags
  returnTags = async (
    chainId: string,
    apiKey: string
  ): Promise<ContractTag[]> => {
    if (String(chainId) !== "100") {
      throw new Error(`Unsupported Chain ID: ${chainId}`);
    }
    let lastTimestamp: number = 0;
    let allTags: ContractTag[] = [];
    let isMore = true;

    const url = prepareUrl(apiKey);

    while (isMore) {
      try {
        const pairs = await fetchData(url, lastTimestamp);
        allTags.push(...transformPairsToTags(chainId, pairs));

        isMore = pairs.length === 1000;
        if (isMore) {
          lastTimestamp = parseInt(
            pairs[pairs.length - 1].createdAtTimestamp.toString(),
            10
          );
        }
      } catch (error) {
        if (isError(error)) {
          console.error(`An error occurred: ${error.message}`);
          throw new Error(`Failed fetching data: ${error}`); // Propagate a new error with more context
        } else {
          console.error("An unknown error occurred.");
          throw new Error("An unknown error occurred during fetch operation."); // Throw with a generic error message if the error type is unknown
        }
      }
    }
    return allTags;
  };
}

// Creating an instance of TagService
const tagService = new TagService();

// Exporting the returnTags method directly
export const returnTags = tagService.returnTags;
