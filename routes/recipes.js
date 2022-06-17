const express = require('express');
const { check, validationResult } = require('express-validator');
const { csrfProtection, asyncHandler } = require('./utils');
const db = require('../db/models'); //db.Model
const { loginUser, logoutUser, requireAuth } = require('../auth');
const { application } = require('express');

const { Op } = require('sequelize');

const router = express.Router();
let errors = [];


router.get('/', async (req, res, next) => {
    const recipes = await db.Recipe.findAll();
    res.render('recipes', { recipes })
})

router.get("/:id(\\d+)", csrfProtection, async (req, res, next) => {
    let userId = null, userHasReview = false;

    const recipeId = req.params.id;
    const recipe = await db.Recipe.findByPk(req.params.id, {
      include: [db.Ingredient, db.Instruction, db.Category],
    });

    let category = recipe.Category.name

    let recipeBoards;
    const reviews = await db.Review.findAll({
      where: { recipeId: req.params.id },
      include: db.User
    });



    let datesObj = {};

    let dates = reviews.map(e => Date.parse(e.createdAt)).map(e => new Date(e).toLocaleDateString());

    reviews.forEach(e => {
        datesObj[e.id] = new Date(Date.parse(e.createdAt)).toLocaleDateString();
    });

    if (req.session.auth) {
        userId = req.session.auth.userId; //gives error when logged out --> fix this
        recipeBoards = await db.Board.findAll({
            where: { userId },
        });

        try {
            let userReviews = await db.Review.findAll({
                where: { recipeId, userId }
            });

            if(userReviews.length > 0) {
                userHasReview = true;
            }
        } catch(e) {
            console.log(e);
        }
    }

    const recipeRatings = await db.Rating.findAll({
        where: { recipeId }
    });

    let ratingsObj = {};

    recipeRatings.forEach(e => {
        ratingsObj[e.userId] = e.value;
    });

    let sum = recipeRatings.reduce(function (sum, rating) {
      return sum + rating.value;
    }, 0);
    let avgratings = sum / recipeRatings.length;

    let userRating

    try {
        userRating = await db.Rating.findOne({
            where: {userId, recipeId}
        })

        userRating = userRating.value;

    } catch (e) {
    }

    avgratings = (Math.round(avgratings * 2) / 2);

    let instructions = recipe.Instructions[0].specification;
    instructions = instructions.replace(`{"`, '');
    instructions = instructions.replace(`"}`, '');
    let formmattedInstructions = instructions.split(`","`);

    res.render("recipe-detail", {
      recipe,
      recipeBoards,
      reviews,
      userId,
      errors,
      avgratings,
      userHasReview,
      userRating,
      category,
      formmattedInstructions,
      datesObj,
      ratingsObj,
      csrfToken: req.csrfToken(),
    });
  });

router.post('/:rId(\\d+)/boards', async (req, res, next) => {
    const recipeId = req.params.rId
    const boardId = req.body.addToBoard
    const recipe = await db.Recipe.findByPk(recipeId);
    const board= await db.Board.findByPk(boardId);

    //NOTE query all recipes on a specific board that belong to a user

    const recipesOnSpecificBoard = await db.RecipesOnBoard.findAll({
        where: {
            boardId
        }
    });
   const recipeIdList = recipesOnSpecificBoard.map(recipe => {
        return recipe.recipeId
    })

    if(!recipeIdList.includes(parseInt(recipeId, 10))) {
        let addedRecipe = await db.RecipesOnBoard.create({
        recipeId,
            boardId
        });
        res.redirect(`/boards/${boardId}`)
    } else {
        errors.push(`${recipe.title} is already on ${board.name}`);
        res.redirect(`/recipes/${recipeId}`)
    }
})


router.post('/:id(\\d+)/review/add', requireAuth, asyncHandler(async(req, res, next) => {
    const { reviewbody } = req.body

    const userId = req.session.auth.userId
    const recipeId = req.params.id
    let userExistingReview = [];

    try{
        userExistingReview = await db.Review.findAll({
            where: { recipeId, userId }
        })
    } catch(e) {
        console.log(e)
    }


    if (userExistingReview.length > 0) {
        res.json({message: 'Exists', userId, reviewId: userExistingReview[0].id})
    }
    else {
        let newReview = await db.Review.create({
            reviewText: reviewbody,
            recipeId,
            userId
        });

        let newReviewId = newReview.id;

        let username = await db.User.findByPk(userId);

        username = username.username;

        res.json({message: 'Success', userId, username, reviewId: newReviewId})
}

}));

router.post('/reviews/:id(\\d+)/edit', requireAuth, asyncHandler(async(req, res, next) => {
    const {theReviewText} = req.body;

    try {
        const reviewToUpdate = await db.Review.findByPk(req.params.id);
        await reviewToUpdate.update({
            reviewText: theReviewText
        });
        await reviewToUpdate.save()
        return res.json({ message: 'Success' })
    } catch(e) {
        console.log(e);
        res.json({message: 'Failure'})
    }
}));

router.delete('/reviews/:id(\\d+)/delete', requireAuth, asyncHandler(async(req, res, next) => {
    const userId = req.session.auth.userId
    reviewId = req.params.id
    const reviewToDelete = await db.Review.findByPk(req.params.id);
    if (reviewToDelete) {
        await reviewToDelete.destroy();
        res.json({message: 'Success'})
        // res.redirect(`/recipes/${reviewToDelete.recipeId}`)
    } else {
        res.json({message: 'Failed'})
    }
}));

router.post("/:id(\\d+)/:rating",requireAuth, asyncHandler(async (req, res, next) => {
    const recipeId = req.params.id;
    // const userId = req.params.uId;
    const value = req.params.rating
    // const ratings = db.Rating.findAll({where: {recipeId}});

    if (req.session.auth) {
        const userId = req.session.auth.userId
        let userRating = await db.Rating.findOne({where: {userId, recipeId}})

        if(userRating) {
            await userRating.update({
                value: value
            })
        }
        else {
            await db.Rating.create({ value, recipeId, userId })
        }
        const recipeRatings = await db.Rating.findAll({ where: { recipeId } });
        let sum;

        sum = recipeRatings.reduce(function (sum, rating) {
            return sum + rating.value;
        }, 0);
        let avgratings = sum / recipeRatings.length;
        //round to nearest .5
        avgratings = Math.round(avgratings * 2) / 2
        res.json({ message: 'success', avgrating: avgratings })
    } else {
        res.json({message: 'failure'})
    }

  })
);

router.all((req, res, next) => {
    next();
});

router.get('/search', asyncHandler(async (req, res, next) => {
    const TERM = req.query.term;

    const RECIPES_WITH_TERM_IN_TITLE = await db.Recipe.findAll({
        where: {
            title: {
                [Op.iLike]: '%' + TERM + '%'
            }
        },
    });
    console.log('\n\nrouter.get ~ RECIPES_WITH_TERM_IN_TITLE', RECIPES_WITH_TERM_IN_TITLE, '\n\n');

    const RECIPES_WITH_TERM_IN_CATEGORY = await db.Recipe.findAll({
        include: {
            model: db.Category,
            where: {
                    name: {
                        [Op.iLike]: '%' + TERM + '%'
                    }
                }
            }
    });

    const RECIPES_WITH_TERM_IN_INGREDIENTS = await db.Ingredient.findAll({
        where: {
            [Op.or]: [
                {
                    name: {
                        [Op.iLike]: '%' + TERM + '%'
                    }
                }
            ]
        },
        include: {
            model: db.Recipe
        }
    });

    let allMatchingRecipes = [...RECIPES_WITH_TERM_IN_CATEGORY, ...RECIPES_WITH_TERM_IN_INGREDIENTS]

    let matchingRecipeIds = new Set();

    for(let recipe of RECIPES_WITH_TERM_IN_TITLE) {
        if(recipe.id) {
            if(!matchingRecipeIds.has(recipe.id)) {
                matchingRecipeIds.add(recipe.id);
            }
        }
    }

    for(let recipe of allMatchingRecipes) {
        if(recipe.Recipe) {
            if(!matchingRecipeIds.has(recipe.Recipe.id)) {
                matchingRecipeIds.add(recipe.Recipe.id);
            }
        }
    }

    let ids = Array.from(matchingRecipeIds);
    let recipes = await db.Recipe.findAll({

        where: {
            id: {
                    [Op.in]: ids
                }
            }
    });

    res.render('search-results', { recipes })
}));

router.all((req, res, next) => {
    console.log('router.get ~ matchingRecipeIds', matchingRecipeIds);
    next();
});

module.exports = router;
