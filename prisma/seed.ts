import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ── Concept Tags ──────────────────────────────────────────────────────────────

const conceptTagData = [
  { slug: "arrays",         label: "Arrays",          sortOrder: 1, description: "List indexing, iteration, mutation, slicing" },
  { slug: "strings",        label: "Strings",          sortOrder: 2, description: "String methods, character operations, pattern checks" },
  { slug: "loops",          label: "Loops",            sortOrder: 3, description: "for/while loops, range, nested loops, loop control" },
  { slug: "conditionals",   label: "Conditionals",     sortOrder: 4, description: "if/elif/else, boolean logic, compound conditions" },
  { slug: "functions",      label: "Functions",        sortOrder: 5, description: "Defining functions, return values, parameters, scope" },
  { slug: "dictionaries",   label: "Dictionaries",     sortOrder: 6, description: "Dict creation, access, iteration, common patterns" },
  { slug: "sorting",        label: "Sorting",          sortOrder: 7, description: "sorted(), .sort(), custom keys, comparison logic" },
  { slug: "recursion-basic",label: "Basic Recursion",  sortOrder: 8, description: "Base case, recursive call, simple recursive patterns" },
  { slug: "two-pointers",   label: "Two Pointers",     sortOrder: 9, description: "Left/right pointer technique on lists or strings" },
  { slug: "edge-cases",     label: "Edge Cases",       sortOrder: 10, description: "Problems specifically designed to force edge case thinking" },
];

// ── Problem Data ──────────────────────────────────────────────────────────────

type TestCaseInput = {
  input: string;
  expectedOutput: string;
  isEdgeCase: boolean;
  orderIndex: number;
  description: string;
};

type ProblemInput = {
  title: string;
  description: string;
  starterCode?: string;
  difficultyTier: "beginner" | "intermediate" | "advanced";
  expectedComplexity?: string;
  conceptTags: string[];
  testCases: TestCaseInput[];
};

const problems: ProblemInput[] = [
  // ── Arrays ─────────────────────────────────────────────────────────────────
  {
    title: "Find the Maximum",
    description: "Given a list of integers, return the largest value. Do not use Python's built-in max() function.",
    starterCode: "def solution(nums):\n    pass",
    difficultyTier: "beginner",
    expectedComplexity: "O(n)",
    conceptTags: ["arrays"],
    testCases: [
      { input: "[3, 1, 4, 1, 5, 9, 2, 6]", expectedOutput: "9",  isEdgeCase: false, orderIndex: 0, description: "standard case" },
      { input: "[10, 20, 30]",              expectedOutput: "30", isEdgeCase: false, orderIndex: 1, description: "ascending order" },
      { input: "[-5, -1, -3]",              expectedOutput: "-1", isEdgeCase: false, orderIndex: 2, description: "all negatives" },
      { input: "[7]",                        expectedOutput: "7",  isEdgeCase: true,  orderIndex: 3, description: "single element" },
      { input: "[5, 5, 5]",                 expectedOutput: "5",  isEdgeCase: true,  orderIndex: 4, description: "all same values" },
    ],
  },
  {
    title: "Reverse a List",
    description: "Given a list, return a new list with the elements in reverse order. Do not use Python's built-in reverse() or slicing shortcut [::-1].",
    starterCode: "def solution(nums):\n    pass",
    difficultyTier: "beginner",
    expectedComplexity: "O(n)",
    conceptTags: ["arrays"],
    testCases: [
      { input: "[1, 2, 3, 4, 5]", expectedOutput: "[5, 4, 3, 2, 1]", isEdgeCase: false, orderIndex: 0, description: "standard case" },
      { input: "[10, 20]",         expectedOutput: "[20, 10]",         isEdgeCase: false, orderIndex: 1, description: "two elements" },
      { input: "[42]",             expectedOutput: "[42]",             isEdgeCase: true,  orderIndex: 2, description: "single element" },
      { input: "[]",               expectedOutput: "[]",               isEdgeCase: true,  orderIndex: 3, description: "empty list" },
    ],
  },
  {
    title: "Remove Duplicates",
    description: "Given a sorted list of integers, return a new list with duplicates removed. The result must remain sorted.",
    starterCode: "def solution(nums):\n    pass",
    difficultyTier: "beginner",
    expectedComplexity: "O(n)",
    conceptTags: ["arrays"],
    testCases: [
      { input: "[1, 1, 2, 3, 3, 4]", expectedOutput: "[1, 2, 3, 4]", isEdgeCase: false, orderIndex: 0, description: "standard case" },
      { input: "[1, 2, 3]",           expectedOutput: "[1, 2, 3]",    isEdgeCase: false, orderIndex: 1, description: "no duplicates" },
      { input: "[5, 5, 5, 5]",        expectedOutput: "[5]",          isEdgeCase: false, orderIndex: 2, description: "all same" },
      { input: "[1]",                  expectedOutput: "[1]",          isEdgeCase: true,  orderIndex: 3, description: "single element" },
      { input: "[]",                   expectedOutput: "[]",           isEdgeCase: true,  orderIndex: 4, description: "empty list" },
    ],
  },
  {
    title: "Second Largest",
    description: "Given a list of integers, return the second largest value. If no second largest exists (all elements are the same, or fewer than 2 elements), return None.",
    starterCode: "def solution(nums):\n    pass",
    difficultyTier: "intermediate",
    expectedComplexity: "O(n)",
    conceptTags: ["arrays"],
    testCases: [
      { input: "[3, 1, 4, 1, 5, 9]", expectedOutput: "5",    isEdgeCase: false, orderIndex: 0, description: "standard case" },
      { input: "[10, 20, 30]",        expectedOutput: "20",   isEdgeCase: false, orderIndex: 1, description: "ascending" },
      { input: "[5, 5, 5]",           expectedOutput: "None", isEdgeCase: true,  orderIndex: 2, description: "all same" },
      { input: "[7]",                  expectedOutput: "None", isEdgeCase: true,  orderIndex: 3, description: "single element" },
      { input: "[]",                   expectedOutput: "None", isEdgeCase: true,  orderIndex: 4, description: "empty list" },
    ],
  },
  {
    title: "Rotate List",
    description: "Given a list and an integer k, rotate the list to the right by k positions. Return the rotated list.",
    starterCode: "def solution(nums, k):\n    pass",
    difficultyTier: "intermediate",
    expectedComplexity: "O(n)",
    conceptTags: ["arrays"],
    testCases: [
      { input: "[[1, 2, 3, 4, 5], 2]", expectedOutput: "[4, 5, 1, 2, 3]", isEdgeCase: false, orderIndex: 0, description: "standard case" },
      { input: "[[1, 2, 3], 1]",        expectedOutput: "[3, 1, 2]",       isEdgeCase: false, orderIndex: 1, description: "rotate by 1" },
      { input: "[[1, 2, 3], 3]",        expectedOutput: "[1, 2, 3]",       isEdgeCase: true,  orderIndex: 2, description: "full rotation" },
      { input: "[[1, 2, 3], 0]",        expectedOutput: "[1, 2, 3]",       isEdgeCase: true,  orderIndex: 3, description: "rotate by 0" },
      { input: "[[5], 10]",             expectedOutput: "[5]",             isEdgeCase: true,  orderIndex: 4, description: "single element" },
    ],
  },

  // ── Strings ────────────────────────────────────────────────────────────────
  {
    title: "Palindrome Check",
    description: "Given a string, return True if it is a palindrome (reads the same forwards and backwards), False otherwise. Ignore case.",
    starterCode: "def solution(s):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["strings"],
    testCases: [
      { input: '"racecar"', expectedOutput: "True",  isEdgeCase: false, orderIndex: 0, description: "standard palindrome" },
      { input: '"Madam"',   expectedOutput: "True",  isEdgeCase: false, orderIndex: 1, description: "case insensitive" },
      { input: '"hello"',   expectedOutput: "False", isEdgeCase: false, orderIndex: 2, description: "not a palindrome" },
      { input: '"a"',       expectedOutput: "True",  isEdgeCase: true,  orderIndex: 3, description: "single character" },
      { input: '""',        expectedOutput: "True",  isEdgeCase: true,  orderIndex: 4, description: "empty string" },
    ],
  },
  {
    title: "Anagram Check",
    description: "Given two strings, return True if they are anagrams of each other (contain the same characters in any order). Ignore case and spaces.",
    starterCode: "def solution(s1, s2):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["strings"],
    testCases: [
      { input: '["listen", "silent"]',         expectedOutput: "True",  isEdgeCase: false, orderIndex: 0, description: "standard anagram" },
      { input: '["hello", "world"]',            expectedOutput: "False", isEdgeCase: false, orderIndex: 1, description: "not anagram" },
      { input: '["Astronomer", "Moon starer"]', expectedOutput: "True",  isEdgeCase: false, orderIndex: 2, description: "case and spaces" },
      { input: '["", ""]',                      expectedOutput: "True",  isEdgeCase: true,  orderIndex: 3, description: "both empty" },
      { input: '["a", "b"]',                    expectedOutput: "False", isEdgeCase: true,  orderIndex: 4, description: "single chars" },
    ],
  },
  {
    title: "Word Frequency",
    description: "Given a string of words, return a dictionary with each word as a key and its frequency as the value. Ignore case. Words are separated by spaces.",
    starterCode: "def solution(text):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["strings", "dictionaries"],
    testCases: [
      { input: '"the cat sat on the mat"', expectedOutput: "{'the': 2, 'cat': 1, 'sat': 1, 'on': 1, 'mat': 1}", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: '"hello"',                  expectedOutput: "{'hello': 1}",                                        isEdgeCase: false, orderIndex: 1, description: "single word" },
      { input: '"Hi hi HI"',               expectedOutput: "{'hi': 3}",                                           isEdgeCase: false, orderIndex: 2, description: "case insensitive" },
      { input: '""',                        expectedOutput: "{}",                                                  isEdgeCase: true,  orderIndex: 3, description: "empty string" },
    ],
  },
  {
    title: "Reverse Words",
    description: "Given a sentence, return the sentence with the order of words reversed. Words are separated by single spaces. Preserve the original capitalisation of each word.",
    starterCode: "def solution(sentence):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["strings"],
    testCases: [
      { input: '"Hello World"',  expectedOutput: '"World Hello"',  isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: '"I love Python"',expectedOutput: '"Python love I"',isEdgeCase: false, orderIndex: 1, description: "three words" },
      { input: '"one"',          expectedOutput: '"one"',          isEdgeCase: true,  orderIndex: 2, description: "single word" },
      { input: '""',             expectedOutput: '""',             isEdgeCase: true,  orderIndex: 3, description: "empty string" },
    ],
  },
  {
    title: "Longest Common Prefix",
    description: "Given a list of strings, find the longest common prefix shared by all strings. If no common prefix exists, return an empty string.",
    starterCode: "def solution(strs):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["strings"],
    testCases: [
      { input: '["flower", "flow", "flight"]', expectedOutput: '"fl"',  isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: '["dog", "car", "racecar"]',     expectedOutput: '""',   isEdgeCase: false, orderIndex: 1, description: "no common prefix" },
      { input: '["abc", "abc", "abc"]',         expectedOutput: '"abc"',isEdgeCase: false, orderIndex: 2, description: "identical strings" },
      { input: '[""]',                           expectedOutput: '""',   isEdgeCase: true,  orderIndex: 3, description: "single empty string" },
      { input: "[]",                             expectedOutput: '""',   isEdgeCase: true,  orderIndex: 4, description: "empty list" },
    ],
  },

  // ── Loops & Conditionals ───────────────────────────────────────────────────
  {
    title: "FizzBuzz",
    description: 'Given an integer n, return a list of strings from 1 to n (inclusive). For multiples of 3, use "Fizz". For multiples of 5, use "Buzz". For multiples of both, use "FizzBuzz".',
    starterCode: "def solution(n):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["loops", "conditionals"],
    testCases: [
      { input: "15", expectedOutput: '["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz"]', isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "3",  expectedOutput: '["1", "2", "Fizz"]',                                                                                         isEdgeCase: false, orderIndex: 1, description: "up to first Fizz" },
      { input: "1",  expectedOutput: '["1"]',                                                                                                       isEdgeCase: true,  orderIndex: 2, description: "single element" },
    ],
  },
  {
    title: "Sum of Digits",
    description: "Given a non-negative integer, return the sum of its digits.",
    starterCode: "def solution(n):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["loops", "conditionals"],
    testCases: [
      { input: "123",  expectedOutput: "6",  isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "9999", expectedOutput: "36", isEdgeCase: false, orderIndex: 1, description: "all nines" },
      { input: "0",    expectedOutput: "0",  isEdgeCase: true,  orderIndex: 2, description: "zero" },
      { input: "7",    expectedOutput: "7",  isEdgeCase: true,  orderIndex: 3, description: "single digit" },
    ],
  },
  {
    title: "Count Primes Up to N",
    description: "Given an integer n, return a list of all prime numbers from 2 to n (inclusive). A prime number is divisible only by 1 and itself.",
    starterCode: "def solution(n):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["loops", "conditionals"],
    testCases: [
      { input: "20", expectedOutput: "[2, 3, 5, 7, 11, 13, 17, 19]", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "10", expectedOutput: "[2, 3, 5, 7]",                  isEdgeCase: false, orderIndex: 1, description: "" },
      { input: "2",  expectedOutput: "[2]",                           isEdgeCase: true,  orderIndex: 2, description: "minimum prime" },
      { input: "1",  expectedOutput: "[]",                            isEdgeCase: true,  orderIndex: 3, description: "below first prime" },
    ],
  },

  // ── Functions ──────────────────────────────────────────────────────────────
  {
    title: "Factorial",
    description: "Write a function that returns the factorial of a given non-negative integer n. Use iteration, not recursion.",
    starterCode: "def solution(n):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["functions", "loops"],
    testCases: [
      { input: "5",  expectedOutput: "120",     isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "10", expectedOutput: "3628800", isEdgeCase: false, orderIndex: 1, description: "larger number" },
      { input: "1",  expectedOutput: "1",       isEdgeCase: true,  orderIndex: 2, description: "base case" },
      { input: "0",  expectedOutput: "1",       isEdgeCase: true,  orderIndex: 3, description: "zero factorial" },
    ],
  },
  {
    title: "Perfect Number Check",
    description: "A perfect number is a positive integer equal to the sum of its proper divisors (excluding itself). Write a function that returns True if n is perfect, False otherwise.",
    starterCode: "def solution(n):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["functions", "loops"],
    testCases: [
      { input: "6",  expectedOutput: "True",  isEdgeCase: false, orderIndex: 0, description: "smallest perfect" },
      { input: "28", expectedOutput: "True",  isEdgeCase: false, orderIndex: 1, description: "second perfect" },
      { input: "12", expectedOutput: "False", isEdgeCase: false, orderIndex: 2, description: "not perfect" },
      { input: "1",  expectedOutput: "False", isEdgeCase: true,  orderIndex: 3, description: "1 has no proper divisors" },
    ],
  },
  {
    title: "Flatten One Level",
    description: "Given a list that may contain nested lists (one level deep only), return a single flat list. Do not use any built-in flatten utilities.",
    starterCode: "def solution(nested):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["functions", "arrays"],
    testCases: [
      { input: "[[1, 2], [3, 4], [5]]", expectedOutput: "[1, 2, 3, 4, 5]", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "[[1], [2], [3]]",        expectedOutput: "[1, 2, 3]",       isEdgeCase: false, orderIndex: 1, description: "all nested" },
      { input: "[1, [2, 3], 4]",         expectedOutput: "[1, 2, 3, 4]",   isEdgeCase: false, orderIndex: 2, description: "mixed flat/nested" },
      { input: "[]",                      expectedOutput: "[]",             isEdgeCase: true,  orderIndex: 3, description: "empty list" },
      { input: "[[]]",                    expectedOutput: "[]",             isEdgeCase: true,  orderIndex: 4, description: "nested empty" },
    ],
  },

  // ── Dictionaries ───────────────────────────────────────────────────────────
  {
    title: "Group by First Letter",
    description: "Given a list of words, return a dictionary where each key is a letter and each value is a list of words starting with that letter. Preserve original capitalisation.",
    starterCode: "def solution(words):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["dictionaries", "strings"],
    testCases: [
      { input: '["apple", "avocado", "banana", "blueberry"]', expectedOutput: "{'a': ['apple', 'avocado'], 'b': ['banana', 'blueberry']}", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: '["cat"]',                                      expectedOutput: "{'c': ['cat']}",                                           isEdgeCase: false, orderIndex: 1, description: "single word" },
      { input: "[]",                                           expectedOutput: "{}",                                                       isEdgeCase: true,  orderIndex: 2, description: "empty list" },
    ],
  },
  {
    title: "Two Sum (Optimal)",
    description: "Given a list of integers and a target sum, return the indices of the two numbers that add up to the target. Each input has exactly one solution. Return as a list [i, j] where i < j.",
    starterCode: "def solution(nums, target):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["dictionaries", "arrays"],
    testCases: [
      { input: "[[2, 7, 11, 15], 9]", expectedOutput: "[0, 1]", isEdgeCase: false, orderIndex: 0, description: "first two elements" },
      { input: "[[3, 2, 4], 6]",      expectedOutput: "[1, 2]", isEdgeCase: false, orderIndex: 1, description: "non-adjacent" },
      { input: "[[3, 3], 6]",          expectedOutput: "[0, 1]", isEdgeCase: true,  orderIndex: 2, description: "duplicate values" },
    ],
  },
  {
    title: "Most Frequent Element",
    description: "Given a list, return the element that appears most frequently. If there is a tie, return the element that appears first in the list.",
    starterCode: "def solution(items):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["dictionaries", "arrays"],
    testCases: [
      { input: "[1, 2, 2, 3, 3, 3]",      expectedOutput: "3",   isEdgeCase: false, orderIndex: 0, description: "clear winner" },
      { input: '["a", "b", "a", "b", "c"]',expectedOutput: "'a'", isEdgeCase: false, orderIndex: 1, description: "tie, first wins" },
      { input: "[5]",                        expectedOutput: "5",   isEdgeCase: true,  orderIndex: 2, description: "single element" },
      { input: "[7, 7, 7]",                  expectedOutput: "7",   isEdgeCase: true,  orderIndex: 3, description: "all same" },
    ],
  },

  // ── Sorting ────────────────────────────────────────────────────────────────
  {
    title: "Sort by Second Element",
    description: "Given a list of tuples, sort them by the second element in ascending order. Return the sorted list.",
    starterCode: "def solution(pairs):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["sorting"],
    testCases: [
      { input: '[("a", 3), ("b", 1), ("c", 2)]', expectedOutput: "[('b', 1), ('c', 2), ('a', 3)]", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: '[("x", 1)]',                       expectedOutput: "[('x', 1)]",                    isEdgeCase: true,  orderIndex: 1, description: "single tuple" },
      { input: "[]",                               expectedOutput: "[]",                            isEdgeCase: true,  orderIndex: 2, description: "empty list" },
    ],
  },
  {
    title: "Sort Strings by Length then Alphabetically",
    description: "Given a list of strings, sort them first by length (shortest first), then alphabetically for strings of the same length.",
    starterCode: "def solution(words):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["sorting", "strings"],
    testCases: [
      { input: '["banana", "apple", "fig", "date"]', expectedOutput: "['fig', 'date', 'apple', 'banana']", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: '["cat", "bat", "hat"]',               expectedOutput: "['bat', 'cat', 'hat']",             isEdgeCase: false, orderIndex: 1, description: "same length" },
      { input: '["a"]',                               expectedOutput: "['a']",                             isEdgeCase: true,  orderIndex: 2, description: "single element" },
      { input: "[]",                                  expectedOutput: "[]",                                isEdgeCase: true,  orderIndex: 3, description: "empty list" },
    ],
  },
  {
    title: "Kth Largest Element",
    description: "Given a list of integers and an integer k, return the kth largest element. k is always valid (1 <= k <= len(nums)).",
    starterCode: "def solution(nums, k):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["sorting", "arrays"],
    testCases: [
      { input: "[[3, 2, 1, 5, 6, 4], 2]",      expectedOutput: "5", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "[[3, 2, 3, 1, 2, 4, 5, 5, 6], 4]", expectedOutput: "4", isEdgeCase: false, orderIndex: 1, description: "with duplicates" },
      { input: "[[1], 1]",                       expectedOutput: "1", isEdgeCase: true,  orderIndex: 2, description: "single element" },
    ],
  },

  // ── Basic Recursion ────────────────────────────────────────────────────────
  {
    title: "Fibonacci",
    description: "Given n, return the nth Fibonacci number using recursion. F(0) = 0, F(1) = 1, F(n) = F(n-1) + F(n-2).",
    starterCode: "def solution(n):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["recursion-basic"],
    testCases: [
      { input: "6",  expectedOutput: "8",  isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "10", expectedOutput: "55", isEdgeCase: false, orderIndex: 1, description: "larger" },
      { input: "0",  expectedOutput: "0",  isEdgeCase: true,  orderIndex: 2, description: "base case zero" },
      { input: "1",  expectedOutput: "1",  isEdgeCase: true,  orderIndex: 3, description: "base case one" },
    ],
  },
  {
    title: "Sum of List Recursively",
    description: "Given a list of integers, return the sum of all elements using recursion. Do not use Python's built-in sum().",
    starterCode: "def solution(nums):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["recursion-basic", "arrays"],
    testCases: [
      { input: "[1, 2, 3, 4, 5]", expectedOutput: "15", isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "[-1, -2, 3]",      expectedOutput: "0",  isEdgeCase: false, orderIndex: 1, description: "with negatives" },
      { input: "[7]",              expectedOutput: "7",  isEdgeCase: true,  orderIndex: 2, description: "single element" },
      { input: "[]",               expectedOutput: "0",  isEdgeCase: true,  orderIndex: 3, description: "empty list" },
    ],
  },
  {
    title: "Binary Search (Recursive)",
    description: "Given a sorted list and a target value, return the index of the target using recursive binary search. Return -1 if not found.",
    starterCode: "def solution(nums, target):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["recursion-basic", "arrays"],
    testCases: [
      { input: "[[1, 3, 5, 7, 9], 7]", expectedOutput: "3",  isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "[[1, 3, 5, 7, 9], 1]", expectedOutput: "0",  isEdgeCase: false, orderIndex: 1, description: "first element" },
      { input: "[[1, 3, 5, 7, 9], 9]", expectedOutput: "4",  isEdgeCase: false, orderIndex: 2, description: "last element" },
      { input: "[[1, 3, 5], 4]",        expectedOutput: "-1", isEdgeCase: true,  orderIndex: 3, description: "not found" },
      { input: "[[5], 5]",              expectedOutput: "0",  isEdgeCase: true,  orderIndex: 4, description: "single element" },
    ],
  },

  // ── Two Pointers ───────────────────────────────────────────────────────────
  {
    title: "Palindrome with Two Pointers",
    description: "Check if a string is a palindrome using the two-pointer technique (left pointer starting at index 0, right pointer at the end). Ignore case. Return True or False.",
    starterCode: "def solution(s):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["two-pointers", "strings"],
    testCases: [
      { input: '"racecar"', expectedOutput: "True",  isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: '"Madam"',   expectedOutput: "True",  isEdgeCase: false, orderIndex: 1, description: "case insensitive" },
      { input: '"hello"',   expectedOutput: "False", isEdgeCase: false, orderIndex: 2, description: "not palindrome" },
      { input: '"a"',       expectedOutput: "True",  isEdgeCase: true,  orderIndex: 3, description: "single character" },
      { input: '""',        expectedOutput: "True",  isEdgeCase: true,  orderIndex: 4, description: "empty string" },
    ],
  },
  {
    title: "Pair Sum in Sorted Array",
    description: "Given a sorted list of integers and a target sum, return True if any two distinct elements sum to the target. Return False otherwise.",
    starterCode: "def solution(nums, target):\n    pass",
    difficultyTier: "intermediate",
    conceptTags: ["two-pointers", "arrays"],
    testCases: [
      { input: "[[1, 2, 3, 4, 6], 6]", expectedOutput: "True",  isEdgeCase: false, orderIndex: 0, description: "standard (2+4)" },
      { input: "[[1, 2, 3, 9], 8]",    expectedOutput: "False", isEdgeCase: false, orderIndex: 1, description: "no valid pair" },
      { input: "[[1, 4, 4, 5], 8]",    expectedOutput: "True",  isEdgeCase: false, orderIndex: 2, description: "duplicate values" },
      { input: "[[1, 2], 3]",           expectedOutput: "True",  isEdgeCase: true,  orderIndex: 3, description: "two-element list" },
      { input: "[[5], 10]",             expectedOutput: "False", isEdgeCase: true,  orderIndex: 4, description: "single element" },
    ],
  },

  // ── Edge Cases ─────────────────────────────────────────────────────────────
  {
    title: "Safe Division",
    description: "Given two numbers a and b, return a divided by b as a float. If b is zero, return None. Handle the case where a is also zero.",
    starterCode: "def solution(a, b):\n    pass",
    difficultyTier: "beginner",
    conceptTags: ["edge-cases", "conditionals"],
    testCases: [
      { input: "[10, 2]", expectedOutput: "5.0",  isEdgeCase: false, orderIndex: 0, description: "standard" },
      { input: "[7, 2]",  expectedOutput: "3.5",  isEdgeCase: false, orderIndex: 1, description: "float result" },
      { input: "[0, 5]",  expectedOutput: "0.0",  isEdgeCase: true,  orderIndex: 2, description: "zero numerator" },
      { input: "[5, 0]",  expectedOutput: "None", isEdgeCase: true,  orderIndex: 3, description: "zero denominator" },
      { input: "[0, 0]",  expectedOutput: "None", isEdgeCase: true,  orderIndex: 4, description: "both zero" },
    ],
  },
];

// ── Seed Function ─────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding Cogniflow database...\n");

  // 1. Upsert concept tags
  console.log("  → Seeding concept tags...");
  for (const tag of conceptTagData) {
    await prisma.conceptTag.upsert({
      where:  { slug: tag.slug },
      update: { label: tag.label, sortOrder: tag.sortOrder, description: tag.description },
      create: tag,
    });
  }
  console.log(`     ✓ ${conceptTagData.length} concept tags ready`);

  // 2. Skip if problems already seeded
  const existingCount = await prisma.problem.count();
  if (existingCount > 0) {
    console.log(`\n  ℹ  Problems already seeded (${existingCount} found). Skipping problem seed.`);
    console.log("\n✅ Done.");
    return;
  }

  // 3. Build slug → id map
  const tags = await prisma.conceptTag.findMany();
  const tagBySlug = Object.fromEntries(tags.map((t) => [t.slug, t.id]));

  // 4. Create each problem with test cases and concept tag links
  console.log("\n  → Seeding problems...");
  let created = 0;

  for (const p of problems) {
    const wordCount = p.description.split(/\s+/).filter(Boolean).length;

    await prisma.problem.create({
      data: {
        title:             p.title,
        description:       p.description,
        wordCount,
        starterCode:       p.starterCode ?? null,
        difficultyTier:    p.difficultyTier,
        expectedComplexity:p.expectedComplexity ?? null,
        problemConceptTags: {
          create: p.conceptTags.map((slug) => ({
            conceptTagId: tagBySlug[slug],
          })),
        },
        testCases: {
          create: p.testCases.map((tc) => ({
            input:          tc.input,
            expectedOutput: tc.expectedOutput,
            isEdgeCase:     tc.isEdgeCase,
            orderIndex:     tc.orderIndex,
            description:    tc.description,
          })),
        },
      },
    });

    created++;
    process.stdout.write(`     ✓ ${created}/${problems.length}: ${p.title}\n`);
  }

  console.log("\n✅ Seed complete.");
  console.log(`   ${conceptTagData.length} concept tags`);
  console.log(`   ${created} problems`);
  const tcCount = await prisma.testCase.count();
  console.log(`   ${tcCount} test cases`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
