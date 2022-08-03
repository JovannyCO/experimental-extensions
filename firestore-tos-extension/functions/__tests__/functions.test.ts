import setupEnvironment from "./helpers/setupEnvironment";
setupEnvironment();

import * as admin from "firebase-admin";
const fft = require("firebase-functions-test")();

import { Acknowledgement } from "../src/interface";
import * as funcs from "../src/index";
import { HttpsError } from "firebase-functions/v1/auth";

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: "demo-test" });
}

const auth = admin.auth();

/** prepare extension functions */
const acceptTermsFn = fft.wrap(funcs.acceptTerms);
const createTermsFn = fft.wrap(funcs.createTerms);
const getTermsFn = fft.wrap(funcs.getTerms);
const getAcknowledgements = fft.wrap(funcs.getAcknowledgements);

describe("functions testing", () => {
  describe("accept terms", () => {
    describe("with a valid terms of service available", () => {
      let user;
      let tosId;

      beforeEach(async () => {
        /** create example user */
        user = await auth.createUser({});

        const randomId = Math.random().toString(36).substring(2, 15);
        tosId = `tos_v${randomId}`;

        await createTermsFn.call(
          {},
          {
            link: "www.link.to.terms",
            tosId,
            noticeType: [],
          },
          { auth: { uid: user.uid } }
        );
      });

      test("can accept a terms of service", async () => {
        await acceptTermsFn.call(
          {},
          {
            tosId,
            noticeType: [],
          },
          { auth: { uid: user.uid } }
        );

        const userRecord = await auth.getUser(user.uid);

        expect(userRecord).toBeDefined();
        expect(userRecord?.customClaims).toBeDefined();

        const terms = userRecord?.customClaims[process.env.EXT_INSTANCE_ID];
        expect(terms).toBeDefined();
        expect(terms[tosId]).toBeDefined();

        const acknowledgement: Acknowledgement = terms[tosId];

        expect(acknowledgement).toBeDefined();
        expect(acknowledgement.tosId).toBeDefined();
        expect(acknowledgement.creationDate).toBeDefined();
        expect(acknowledgement.acceptanceDate).toBeDefined();
      });

      test("can accept multiple terms of service agreements", async () => {
        const tosId_2 = tosId + "_2";

        /** create a second agreement */
        await createTermsFn.call(
          {},
          {
            link: "www.link.to.terms",
            tosId: tosId_2,
            noticeType: [],
          },
          { auth: { uid: user.uid } }
        );

        await acceptTermsFn.call({}, { tosId }, { auth: { uid: user.uid } });
        await acceptTermsFn.call(
          {},
          { tosId: tosId_2 },
          { auth: { uid: user.uid } }
        );

        const userRecord = await auth.getUser(user.uid);

        const terms = userRecord?.customClaims[process.env.EXT_INSTANCE_ID];
        const acknowledgements: Acknowledgement = terms;

        expect(Object.keys(acknowledgements)).toHaveLength(2);
      });

      test("successfully appends exisiting custom claims", async () => {
        /** set example custom claims on the user */
        await auth.setCustomUserClaims(user.uid, { foo: "bar" });

        /** accept terms */
        await acceptTermsFn.call({}, { tosId }, { auth: { uid: user.uid } });

        const userRecord = await auth.getUser(user.uid);

        const terms = userRecord?.customClaims[process.env.EXT_INSTANCE_ID];
        const acknowledgements: Acknowledgement = terms;

        expect(userRecord.customClaims["foo"]).toEqual("bar");
        expect(acknowledgements).toBeDefined();
      });
    });

    describe("without a valid user", () => {
      let user;
      let tosId;

      beforeEach(async () => {
        /** create example user */
        user = await auth.createUser({});

        const randomId = Math.random().toString(36).substring(2, 15);
        tosId = `tos_v${randomId}`;
      });

      test("does not add a terms of service", async () => {
        expect(
          async () =>
            await acceptTermsFn.call({}, { tosId, noticeType: [] }, {})
        ).rejects.toThrow("No valid authentication token provided.");
      });
    });

    describe("Without a valid terms of service agreement", () => {
      let user;

      beforeEach(async () => {
        /** create example user */
        user = await auth.createUser({});
      });

      test("does not add a terms of service without a provided tosId", async () => {
        expect(
          async () =>
            await acceptTermsFn.call({}, {}, { auth: { uid: user.uid } })
        ).rejects.toThrow("No tosId provided.");
      });

      test("does not add a terms of service without a exisiting tosId", async () => {
        await acceptTermsFn.call(
          {},
          { tosId: "unknown", noticeType: [] },
          { auth: { uid: user.uid } }
        );

        const userRecord = await auth.getUser(user.uid);

        const claims = userRecord?.customClaims;

        expect(claims).toBeUndefined();
      });
    });
  });

  describe("get terms", () => {
    let user;
    let tosId;

    beforeEach(async () => {
      /** create example user */
      user = await auth.createUser({});

      const randomId = Math.random().toString(36).substring(2, 15);
      tosId = `tos_v${randomId}`;
    });

    test("can get a terms of service", async () => {
      await createTermsFn.call(
        {},
        {
          link: "www.link.to.terms",
          tosId,
          creationDate: new Date().toLocaleDateString(),
          noticeType: [
            {
              role: "publisher",
            },
          ],
        },
        { auth: { uid: "test" } }
      );

      const terms = await getTermsFn.call(
        {},
        { tosId },
        { auth: { uid: user.uid } }
      );

      expect(terms).toBeDefined();
      expect(terms?.link).toBeDefined();
      expect(terms?.tosId).toBeDefined();
      expect(terms?.creationDate).toBeDefined();
      expect(terms?.noticeType[0].role).toBe("publisher");
    });

    test("can get a terms of service by tosId", async () => {
      await createTermsFn.call(
        {},
        {
          link: "www.link.to.terms",
          tosId,
          noticeType: [],
        },
        { auth: { uid: user.uid } }
      );

      const terms = await getTermsFn.call(
        {},
        { tosId },
        { auth: { uid: user.uid } }
      );

      expect(terms).toBeDefined();
      expect(terms?.link).toBeDefined();
      expect(terms?.tosId).toBeDefined();
      expect(terms?.creationDate).toBeDefined();
    });

    test("can get a terms with a custom filter", async () => {
      await createTermsFn.call(
        {},
        {
          link: "www.test.com",
          tosId,
          noticeType: [{ role: "publisher" }],
        },
        { auth: { uid: user.uid } }
      );

      const terms = await getTermsFn.call(
        {},
        { custom_filter: { role: "publisher" } },
        { auth: { uid: user.uid } }
      );

      const toCheck = terms.filter(($) => $.tosId === tosId)[0];

      expect(toCheck).toBeDefined();
      expect(toCheck?.link).toBeDefined();
      expect(toCheck?.tosId).toBeDefined();
      expect(toCheck?.creationDate).toBeDefined();
      expect(toCheck?.noticeType[0].role).toEqual("publisher");
    });
  });

  describe("create terms", () => {
    let user;
    let tosId;

    beforeEach(async () => {
      /** create example user */
      user = await auth.createUser({});

      const randomId = Math.random().toString(36).substring(2, 15);
      tosId = `tos_v${randomId}`;
    });

    test("can create a terms of service", async () => {
      const link = "www.link.to.terms";
      const noticeType = [{ role: "publisher" }];

      await createTermsFn.call(
        {},
        { tosId, link, noticeType },
        { auth: { uid: "test" } }
      );

      const terms = await admin
        .firestore()
        .collection("terms")
        .doc("agreements")
        .collection("tos")
        .doc(tosId)
        .get()
        .then((doc) => doc.data());

      expect(terms.tosId).toEqual(tosId);
      expect(terms.link).toEqual(link);
      expect(terms.noticeType).toEqual(noticeType);
      expect(terms.creationDate).toBeDefined();
      expect(terms.acceptanceDate).toBeUndefined();
    });

    test("should throw an error when a valid notice type has not been provided", async () => {
      const link = "www.link.to.terms";
      const creationDate = new Date().toLocaleDateString();

      expect(
        async () =>
          await createTermsFn.call(
            {},
            { tosId, link, creationDate },
            { auth: { uid: "test" } }
          )
      ).rejects.toThrow("Invalid notice type");
    });
  });

  describe("get acknowledgements", () => {
    let user;
    let tosId;

    beforeEach(async () => {
      /** create example user */
      user = await auth.createUser({});

      const randomId = Math.random().toString(36).substring(2, 15);
      tosId = `tos_v${randomId}`;
    });

    test("can get an acknowledgment", async () => {
      const link = "www.link.to.terms";

      /** create terms */
      await createTermsFn.call(
        {},
        {
          link,
          tosId,
          noticeType: [],
        },
        { auth: { uid: user.uid } }
      );

      /** accept terms */
      await acceptTermsFn.call({}, { tosId }, { auth: { uid: user.uid } });

      /** get terms */
      const acknowledgements = await getAcknowledgements.call(
        {},
        { tosId },
        { auth: { uid: user.uid } }
      );

      expect(acknowledgements).toBeDefined();
      expect(acknowledgements[tosId].creationDate).toBeDefined();
      expect(acknowledgements[tosId].acceptanceDate).toBeDefined();
    });
  });
});
