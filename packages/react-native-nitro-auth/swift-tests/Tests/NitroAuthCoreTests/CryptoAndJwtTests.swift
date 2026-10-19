import XCTest
import Security
import NitroAuthCryptoC
@testable import NitroAuthCore

final class CryptoAndJwtTests: XCTestCase {
  private let payloadJson: AuthCore.JwtPayloadJson = { NitroAuthJwtPayloadJson($0, $1, $2) }
  private let systemRandom: AuthCore.RandomSource = { bytes in
    SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess
  }

  private func fixedRandom(_ value: UInt8) -> AuthCore.RandomSource {
    { bytes in
      for index in bytes.indices { bytes[index] = value }
      return true
    }
  }

  private func encode(_ payload: Data) -> String {
    AuthCore.base64Url(payload)
  }

  private func jwt(_ payload: String) -> String {
    "header.\(encode(Data(payload.utf8))).signature"
  }

  private func decode(_ token: String) -> [String: String] {
    AuthCore.decodeJwt(token, payloadJson: payloadJson)
  }

  private func isBase64Url(_ value: String, length: Int) -> Bool {
    value.range(of: "^[A-Za-z0-9_-]{\(length)}$", options: .regularExpression) != nil
  }

  func testBase64UrlHasNoPaddingAndUsesTheUrlAlphabet() {
    XCTAssertEqual(AuthCore.base64Url(Data()), "")
    XCTAssertEqual(AuthCore.base64Url(Data([0xfb, 0xff, 0xbf])), "-_-_")
    XCTAssertEqual(AuthCore.base64Url(Data([0xff])), "_w")
    XCTAssertEqual(AuthCore.base64Url(Data([0xff, 0xff])), "__8")
  }

  func testCreateNonceHashMatchesCCSHA256() throws {
    let zero = try XCTUnwrap(AuthCore.createNonce(random: fixedRandom(0)))
    XCTAssertEqual(zero.raw, String(repeating: "A", count: 43))
    XCTAssertEqual(zero.hashed, "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a")

    let ones = try XCTUnwrap(AuthCore.createNonce(random: fixedRandom(0xff)))
    XCTAssertEqual(ones.hashed, "225f7e75329dd45aa354975d73987319309393af3a4c6733bc13601a4f1b8796")
    XCTAssertNil(AuthCore.createNonce(random: { _ in false }))
  }

  func testNonceIsUrlSafeRandomAndHashedWithSha256() throws {
    let zero = try XCTUnwrap(AuthCore.createNonce(random: fixedRandom(0)))
    XCTAssertEqual(zero.raw, String(repeating: "A", count: 43))
    XCTAssertTrue(zero.hashed.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil)

    let ones = try XCTUnwrap(AuthCore.createNonce(random: fixedRandom(0xff)))
    XCTAssertEqual(ones.raw, String(repeating: "_", count: 42) + "8")
    XCTAssertNotEqual(ones.hashed, zero.hashed)
    XCTAssertEqual(ones.hashed, AuthCore.sha256Hex(Data(ones.raw.utf8)))

    let first = try XCTUnwrap(AuthCore.createNonce(random: systemRandom))
    let second = try XCTUnwrap(AuthCore.createNonce(random: systemRandom))
    for nonce in [first, second] {
      XCTAssertTrue(isBase64Url(nonce.raw, length: 43), nonce.raw)
      XCTAssertTrue(nonce.hashed.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil)
    }
    XCTAssertNotEqual(first.raw, second.raw)
  }

  func testKnownSha256VectorsFlowThroughTheNonceHash() {
    XCTAssertEqual(AuthCore.sha256Hex(Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    XCTAssertEqual(AuthCore.sha256Hex(Data()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  }

  func testRandomFailureProducesNoNonceAndNoVerifier() {
    let failingRandom: AuthCore.RandomSource = { _ in false }
    XCTAssertNil(AuthCore.createNonce(random: failingRandom))
    XCTAssertNil(AuthCore.generateCodeVerifier(random: failingRandom))
  }

  func testPkceVerifierAndChallengeFollowRfc7636() throws {
    XCTAssertEqual(AuthCore.generateCodeVerifier(random: fixedRandom(0)), String(repeating: "A", count: 43))
    XCTAssertEqual(AuthCore.generateCodeVerifier(random: fixedRandom(0xff)), String(repeating: "_", count: 42) + "8")
    let first = try XCTUnwrap(AuthCore.generateCodeVerifier(random: systemRandom))
    let second = try XCTUnwrap(AuthCore.generateCodeVerifier(random: systemRandom))
    XCTAssertTrue(isBase64Url(first, length: 43), first)
    XCTAssertNotEqual(first, second)

    XCTAssertEqual(
      AuthCore.generateCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    )
    XCTAssertEqual(AuthCore.generateCodeChallenge(""), "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU")
    XCTAssertTrue(isBase64Url(try XCTUnwrap(AuthCore.generateCodeChallenge(first)), length: 43))
    XCTAssertTrue(isBase64Url(try XCTUnwrap(AuthCore.generateCodeChallenge(String(repeating: "a", count: 1_000_000))), length: 43))
    XCTAssertNil(AuthCore.generateCodeChallenge("vérifier"))
    XCTAssertNil(AuthCore.generateCodeChallenge("🚀"))
  }

  func testMalformedJwtsDecodeToAnEmptyClaimMap() {
    let malformed = [
      "",
      ".",
      "..",
      "header-only",
      "header.",
      "header..signature",
      "header.!!!!.signature",
      "header.e30 .signature",
      "header.\(encode(Data("not json".utf8))).signature",
      "header.\(encode(Data("[1,2,3]".utf8))).signature",
      "header.\(encode(Data("null".utf8))).signature",
      "header.\(encode(Data("{\"unterminated\":".utf8))).signature",
      "header.\(encode(Data("{}".utf8))).signature",
      "header.\(encode(Data("{\"a\":1}".utf8)))",
      String(repeating: ".", count: 100_000),
      "header." + String(repeating: "!", count: 100_000) + ".signature",
    ]
    for token in malformed {
      XCTAssertEqual(decode(token), [:], String(token.prefix(80)))
    }
  }

  func testScalarClaimsBecomeStringsAndOtherShapesAreDropped() {
    let claims = decode(jwt(
      "{\"nonce\":\"n1\",\"exp\":1789500000,\"far\":4102444800,\"ratio\":1.5,\"verified\":true,\"blocked\":false," +
        "\"empty\":\"\",\"nothing\":null,\"list\":[\"a\"],\"nested\":{\"a\":1},\"name\":\"Ada 🚀\"}"
    ))
    XCTAssertEqual(claims, [
      "nonce": "n1",
      "exp": "1789500000",
      "far": "4102444800",
      "ratio": "1.5",
      "verified": "true",
      "blocked": "false",
      "empty": "",
      "name": "Ada 🚀",
    ])
  }

  func testHugePayloadsAndStandardAlphabetAreDecoded() {
    let largeName = String(repeating: "n", count: 512 * 1024)
    XCTAssertEqual(decode(jwt("{\"name\":\"\(largeName)\"}"))["name"], largeName)

    let payload = Data("{\"k\":\"??>>\"}".utf8)
    let standard = payload.base64EncodedString()
    XCTAssertTrue(standard.contains("/") || standard.contains("+"))
    XCTAssertEqual(decode("header.\(standard).signature")["k"], "??>>")
  }

  func testMalformedUtf8ClaimIsRejected() {
    var payload = Data("{\"name\":\"".utf8)
    payload.append(contentsOf: [0xc3, 0x28])
    payload.append(Data("\"}".utf8))
    XCTAssertEqual(decode("e30.\(encode(payload)).signature"), [:])

    var truncated = Data("{\"nonce\":\"n1\",\"name\":\"".utf8)
    truncated.append(contentsOf: [0xf0, 0x9f])
    truncated.append(Data("\"}".utf8))
    XCTAssertEqual(decode("e30.\(encode(truncated)).signature"), [:])
  }

  func testPayloadWithAnEmbeddedNulIsRejectedInsteadOfTruncated() {
    var payload = Data("{\"nonce\":\"n1\"}".utf8)
    payload.append(0)
    payload.append(Data("{\"nonce\":\"other\"}".utf8))
    XCTAssertEqual(decode("e30.\(encode(payload)).signature"), [:])

    var inside = Data("{\"nonce\":\"n".utf8)
    inside.append(0)
    inside.append(Data("1\"}".utf8))
    XCTAssertEqual(decode("e30.\(encode(inside)).signature"), [:])
  }

  func testDecoderFailureAndBufferContractAreHonoured() {
    XCTAssertEqual(AuthCore.decodeJwt("a.b.c", payloadJson: { _, _, _ in -1 }), [:])

    var capacities: [Int] = []
    _ = AuthCore.decodeJwt("", payloadJson: { _, _, capacity in
      capacities.append(capacity)
      return -1
    })
    _ = AuthCore.decodeJwt(String(repeating: "x", count: 100), payloadJson: { _, _, capacity in
      capacities.append(capacity)
      return -1
    })
    XCTAssertEqual(capacities, [8, 200])

    XCTAssertEqual(AuthCore.jwtClaimString("text"), "text")
    XCTAssertEqual(AuthCore.jwtClaimString(NSNumber(value: true)), "true")
    XCTAssertEqual(AuthCore.jwtClaimString(NSNumber(value: 0)), "0")
    XCTAssertEqual(AuthCore.jwtClaimString(NSNumber(value: Int64.max)), "9223372036854775807")
    XCTAssertNil(AuthCore.jwtClaimString(NSNull()))
    XCTAssertNil(AuthCore.jwtClaimString(["a"]))
  }
}
